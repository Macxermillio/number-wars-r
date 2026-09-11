import type { gameState } from "../../assets/start.ts";
import type { AiAction } from "./simulation.ts";
import { legalActions, cloneState, applyAction, evaluateState, distToStarFocus } from "./simulation.ts";

// ============================================================================
// Hard/Insane-mode Computer opponent: minimax search with alpha-beta pruning
// and move ordering by capture/shard/merge/star-zone value.
// - hard:   depth 3, balanced tournament play.
// - insane: depth 5 with iterative deepening + time budget, star-win obsessed
//           and the strongest/toughest bot. It takes an immediate star win
//           over everything, denies the opponent's star win, pre-positions
//           for upcoming star spawns, keeps mobility splits, and sees tactics
//           one full round deeper than hard.
// Plays red (or any affiliation).
// ============================================================================

export type MinimaxDifficulty = "hard" | "insane";

type CacheEntry = { depth: number; score: number };
const transposition = new Map<string, CacheEntry>();

const MAX_DEPTH: Record<MinimaxDifficulty, number> = {
    hard: 3,
    insane: 5,
};

// Terminal score helpers so forced wins propagate up the tree even when
// they happen before depth 0 (critical for insane to never miss a win).
function terminalScore(state: gameState, rootAffiliation: "red" | "blue"): number | null {
    const starsToWin = state.starsToWin || 10;
    const myStars = rootAffiliation === "red" ? state.redStars : state.blueStars;
    const theirStars = rootAffiliation === "red" ? state.blueStars : state.redStars;
    if (myStars >= starsToWin) return 100000;
    if (theirStars >= starsToWin) return -100000;
    const ours = rootAffiliation === "red" ? state.redPieces : state.bluePieces;
    const theirs = rootAffiliation === "red" ? state.bluePieces : state.redPieces;
    if (theirs.length === 0) return 10000;
    if (ours.length === 0) return -10000;
    return null;
}

function stateKey(state: gameState): string {
    const pieces = [...state.redPieces, ...state.bluePieces]
        .map((p) => `${p.affiliation[0]}${p.position[0]},${p.position[1]}:${p.strength},${p.armor},${p.spike},${p.range}`)
        .sort().join("|");
    const terrain = Object.entries(state.board)
        .filter(([, s]) => s.bricked || s.shard !== undefined || s.star === true)
        .map(([k, s]) => `${k}:${s.bricked ? "b" : ""}${s.shard || ""}${s.star ? "s" : ""}`).join("|");
    return `${state.turn}:${state.turnEffect}:${state.turnCount}:${state.redStars}:${state.blueStars}:${pieces}:${terrain}`;
}

// Does this move instantly win the game for `affiliation` (star win or
// wiping the enemy)? Used for the insane instant-win pre-check.
function moveWinsImmediately(state: gameState, mv: AiAction, affiliation: "red" | "blue"): boolean {
    const sim = cloneState(state);
    const res = applyAction(sim, mv);
    if (res.error) return false;
    const score = terminalScore(sim, affiliation);
    return score !== null && score > 0;
}

function captureCount(state: gameState, affiliation: "red" | "blue"): number {
    return legalActions(state, affiliation).filter((action) => action.type === "move" &&
        !!state.board[`${action.to[0]},${action.to[1]}`]?.tenant &&
        state.board[`${action.to[0]},${action.to[1]}`]?.tenant?.affiliation !== affiliation).length;
}

export function isMeaningfulSplit(state: gameState, action: AiAction, affiliation: "red" | "blue"): boolean {
    if (action.type !== "split") return true;
    const beforeMobility = legalMovesForEvaluation(state, affiliation);
    const beforeCaptures = captureCount(state, affiliation);
    const beforeStar = minStarDistance(state, affiliation);
    const sim = cloneState(state);
    if (applyAction(sim, action).error) return false;
    const mobilityDelta = legalMovesForEvaluation(sim, affiliation) - beforeMobility;
    const captureDelta = captureCount(sim, affiliation) - beforeCaptures;
    const starDelta = beforeStar - minStarDistance(sim, affiliation);
    // Splitting normally reduces total armor and can reduce range, so require
    // a concrete new capture, a solid mobility gain, or a clearly better
    // star-contest position (extra body near the live star / spawn focus).
    return captureDelta > 0 || mobilityDelta >= 4 || starDelta >= 2;
}

function minStarDistance(state: gameState, affiliation: "red" | "blue"): number {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    if (pieces.length === 0) return 99;
    const starKey = (Object.entries(state.board) as [string, { star?: boolean }][]).find(([, sq]) => sq.star === true)?.[0];
    if (starKey) {
        const [sc, sr] = starKey.split(",").map(Number) as [number, number];
        return Math.min(...pieces.map((p) => Math.abs(p.position[0] - sc) + Math.abs(p.position[1] - sr)));
    }
    return Math.min(...pieces.map((p) => distToStarFocus(p.position[0], p.position[1])));
}

// How urgently should Insane contest star positioning? 3x when a star is
// live or dropping within 2 turns, 2x within 5 turns, else 1x.
function starUrgency(state: gameState): number {
    const live = (Object.values(state.board) as { star?: boolean }[]).some((sq) => sq.star === true);
    if (live) return 3;
    const turnsAway = (state.starTurn ?? 0) - (state.turnCount ?? 0);
    if (turnsAway <= 2) return 3;
    if (turnsAway <= 5) return 2;
    return 1;
}

function legalMovesForEvaluation(state: gameState, affiliation: "red" | "blue"): number {
    return legalActions(state, affiliation).filter((action) => action.type === "move").length;
}

// Order moves so likely-good ones (captures, star pickups, star-zone
// positioning, shard pickups, merges) come first — this makes alpha-beta
// prune much more effectively. Insane mode massively up-weights a star
// pickup that wins the game immediately, plus star denial when the enemy
// is one star from winning.
function orderMoves(state: gameState, moves: AiAction[], affiliation: "red" | "blue", difficulty: MinimaxDifficulty = "hard"): AiAction[] {
    const starKey = (Object.entries(state.board) as [string, { star?: boolean }][]).find(([, sq]) => sq.star === true)?.[0];
    const starPos = starKey ? starKey.split(",").map(Number) as [number, number] : null;
    const starsToWin = state.starsToWin || 10;
    const myStars = affiliation === "red" ? state.redStars : state.blueStars;
    const enemyStars = affiliation === "red" ? state.blueStars : state.redStars;
    const iWinWithStar = myStars + 1 >= starsToWin;
    const enemyWinsWithStar = enemyStars + 1 >= starsToWin;
    const urgency = difficulty === "insane" ? starUrgency(state) : 1;
    const ranked = moves.map((mv) => {
        let score = 0;
        if (mv.type !== "move") {
            if (mv.type === "split") {
                // Meaningful mobility/star splits compete with quiet moves;
                // pointless splits stay at the very bottom so breadth caps drop them first.
                score += isMeaningfulSplit(state, mv, affiliation) ? 140 : -100;
            } else {
                score += mv.type === "strengthen" ? 90 : 80;
            }
            return { mv, score };
        }
        const to = state.board[`${mv.to[0]},${mv.to[1]}`];
        if (to?.tenant) {
            if (to.tenant.affiliation !== affiliation) score += 1000; // capture
            else score += 50; // merge
        } else if (to?.star) {
            // Star pickup — alternate win condition. Insane takes a
            // game-winning star above EVERYTHING (captures included).
            score += iWinWithStar && difficulty === "insane" ? 100000 : 800;
        } else if (to?.shard) {
            score += 30; // shard pickup
        }
        // Star-zone contest: prefer moves that land on/near the live star,
        // or (no star on board) near the hot-zone squares where the next
        // star will spawn, so positional moves are searched first.
        // Insane contests harder and scales with urgency: a live/imminent
        // star is worth far more than a distant future spawn.
        const zoneMul = difficulty === "insane" ? 2 * urgency : 1;
        if (starPos) {
            const d = Math.abs(mv.to[0] - starPos[0]) + Math.abs(mv.to[1] - starPos[1]);
            score += Math.max(0, 12 - d) * 6 * zoneMul;
            if (difficulty === "insane" && enemyWinsWithStar && d === 0) score += 20000; // deny enemy win
        } else {
            const d = distToStarFocus(mv.to[0], mv.to[1]);
            if (d <= 5) score += (6 - d) * 5 * zoneMul;
        }
        return { mv, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((r) => r.mv);
}

const INSANE_TIME_BUDGET_MS = Math.max(
    250,
    parseInt(process.env.COMPUTER_INSANE_MS || "1800", 10) || 1800
);

// Breadth caps scaled by remaining depth so depth 5 stays affordable.
// Root keeps the widest beam (star/capture/meaningful-split moves first);
// deeper plies get progressively narrower.
function breadthCap(depthRemaining: number, isRoot: boolean): number {
    if (isRoot) return 18;
    if (depthRemaining >= 4) return 10;
    if (depthRemaining === 3) return 8;
    if (depthRemaining === 2) return 6;
    return 5;
}

class SearchTimeout extends Error {}

type SearchCtx = { deadline: number; nodes: number };

export function pickMinimaxMove(state: gameState, affiliation: "red" | "blue", difficulty: MinimaxDifficulty = "hard"): AiAction | null {
    if (difficulty === "insane" && transposition.size > 50000) transposition.clear();
    const ordered = orderMoves(state, legalActions(state, affiliation), affiliation, difficulty);
    if (ordered.length === 0) return null;

    // Insane instant-win pre-check: if any legal move wins RIGHT NOW
    // (star win or wiping the enemy), take it without searching. This
    // guarantees the bot never "thinks past" a forced win.
    if (difficulty === "insane") {
        for (const mv of ordered) {
            if (moveWinsImmediately(state, mv, affiliation)) return mv;
        }
    }

    if (difficulty !== "insane") {
        let bestMove: AiAction | null = null;
        let bestScore = -Infinity;
        for (const mv of ordered) {
            const sim = cloneState(state);
            if (applyAction(sim, mv).error) continue;
            const score = minimax(sim, MAX_DEPTH[difficulty] - 1, -Infinity, Infinity, affiliation === "red" ? "blue" : "red", affiliation, difficulty);
            if (score > bestScore) {
                bestScore = score;
                bestMove = mv;
            }
        }
        return bestMove;
    }

    // Insane: iterative deepening 1..5 under a time budget. The instant-win
    // scan above already covered EVERY move, so capping the root to the most
    // promising ordered moves is safe: captures, winning/denying stars,
    // star-zone moves and meaningful mobility splits rank first.
    const rootMoves = ordered.slice(0, breadthCap(99, true))
        .filter((mv) => mv.type !== "split" || isMeaningfulSplit(state, mv, affiliation));
    if (rootMoves.length === 0) return null;
    const ctx: SearchCtx = { deadline: Date.now() + INSANE_TIME_BUDGET_MS, nodes: 0 };
    let bestMove: AiAction | null = rootMoves[0] ?? null;
    for (let depth = 1; depth <= MAX_DEPTH.insane; depth++) {
        try {
            let iterBest: AiAction | null = null;
            let iterScore = -Infinity;
            let alpha = -Infinity;
            for (const mv of rootMoves) {
                const sim = cloneState(state);
                if (applyAction(sim, mv).error) continue;
                const score = minimax(sim, depth - 1, alpha, Infinity, affiliation === "red" ? "blue" : "red", affiliation, difficulty, ctx);
                if (score > iterScore) {
                    iterScore = score;
                    iterBest = mv;
                }
                alpha = Math.max(alpha, iterScore);
            }
            if (iterBest) bestMove = iterBest;
            if (Date.now() >= ctx.deadline) break;
        } catch (e) {
            if (e instanceof SearchTimeout) break;
            throw e;
        }
    }
    return bestMove;
}

// Classic minimax with alpha-beta. `turnAffiliation` is whose turn it is at
// this node; `rootAffiliation` is the player we're optimizing for.
function minimax(
    state: gameState,
    depth: number,
    alpha: number,
    beta: number,
    turnAffiliation: "red" | "blue",
    rootAffiliation: "red" | "blue",
    difficulty: MinimaxDifficulty = "hard",
    ctx?: SearchCtx
): number {
    if (ctx && (++ctx.nodes % 512 === 0) && Date.now() >= ctx.deadline) throw new SearchTimeout();
    // Forced wins/losses propagate immediately at any depth — insane must
    // see a star win coming even 4 plies out and never trade it away.
    const terminal = terminalScore(state, rootAffiliation);
    if (terminal !== null) return terminal;
    if (depth <= 0) {
        return quiescence(state, alpha, beta, rootAffiliation, difficulty, ctx);
    }

    const key = `${rootAffiliation}:${stateKey(state)}`;
    const cached = transposition.get(key);
    if (cached && cached.depth >= depth) return cached.score;

    const isMax = turnAffiliation === rootAffiliation;
    let moves = orderMoves(state, legalActions(state, turnAffiliation), turnAffiliation, difficulty);
    if (moves.length === 0) {
        // No legal moves: evaluate as-is (very rare — pinned pieces; treated
        // as a pass).
        return evaluateState(state, rootAffiliation);
    }
    // Depth-scaled breadth caps keep depth 5 affordable: alpha-beta prunes
    // the rest while star/capture/meaningful-split moves are searched first.
    if (difficulty === "insane") {
        moves = moves.filter((mv) => mv.type !== "split" || isMeaningfulSplit(state, mv, turnAffiliation));
        const cap = breadthCap(depth, false);
        if (moves.length > cap) moves = moves.slice(0, cap);
    }

    let best = isMax ? -Infinity : Infinity;
    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyAction(sim, mv);
        if (res.error) continue;
        const nextTurn = turnAffiliation === "red" ? "blue" : "red";
        const score = minimax(sim, depth - 1, alpha, beta, nextTurn, rootAffiliation, difficulty, ctx);

        if (isMax) {
            best = Math.max(best, score);
            alpha = Math.max(alpha, best);
        } else {
            best = Math.min(best, score);
            beta = Math.min(beta, best);
        }
        if (beta <= alpha) break; // prune
    }

    transposition.set(key, { depth, score: best });
    return best;
}

// Quiescence: at depth 0, keep searching captures, star grabs/denials and
// meaningful mobility splits so Insane never stops mid-tactic and mistakes
// a hanging piece or an open star for a quiet position.
function quiescence(
    state: gameState,
    alpha: number,
    beta: number,
    rootAffiliation: "red" | "blue",
    difficulty: MinimaxDifficulty,
    ctx?: SearchCtx
): number {
    if (ctx && (++ctx.nodes % 512 === 0) && Date.now() >= ctx.deadline) throw new SearchTimeout();
    const terminal = terminalScore(state, rootAffiliation);
    if (terminal !== null) return terminal;
    const standPat = evaluateState(state, rootAffiliation);
    if (difficulty !== "insane") return standPat;
    const isMax = state.turn === rootAffiliation;
    let best = standPat;
    if (isMax) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (beta <= alpha) return best;
    const tactical = orderMoves(state, legalActions(state, state.turn), state.turn, difficulty)
        .filter((mv) => {
            if (mv.type !== "move") return mv.type === "split" && isMeaningfulSplit(state, mv, state.turn);
            const sq = state.board[`${mv.to[0]},${mv.to[1]}`];
            return !!sq?.tenant || !!sq?.star;
        })
        .slice(0, 8);
    for (const mv of tactical) {
        const sim = cloneState(state);
        if (applyAction(sim, mv).error) continue;
        const score = quiescence(sim, alpha, beta, rootAffiliation, difficulty, ctx);
        if (isMax) {
            best = Math.max(best, score);
            alpha = Math.max(alpha, best);
        } else {
            best = Math.min(best, score);
            beta = Math.min(beta, best);
        }
        if (beta <= alpha) break;
    }
    return best;
}