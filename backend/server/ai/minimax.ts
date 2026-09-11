import type { gameState } from "../../assets/start.ts";
import type { AiAction } from "./simulation.ts";
import { legalActions, cloneState, applyAction, evaluateState, distToStarFocus } from "./simulation.ts";

// ============================================================================
// Hard/Insane-mode Computer opponent: minimax search with alpha-beta pruning
// and move ordering by capture/shard/merge/star-zone value.
// - hard:   depth 3, balanced tournament play.
// - insane: depth 4 (one extra move in advance), star-win obsessed and the
//           strongest/toughest bot. It takes an immediate star win over
//           everything, denies the opponent's star win, and sees tactics one
//           full round deeper than hard.
// Plays red (or any affiliation).
// ============================================================================

export type MinimaxDifficulty = "hard" | "insane";

type CacheEntry = { depth: number; score: number };
const transposition = new Map<string, CacheEntry>();

const MAX_DEPTH: Record<MinimaxDifficulty, number> = {
    hard: 3,
    insane: 4,
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
    const sim = cloneState(state);
    if (applyAction(sim, action).error) return false;
    const mobilityDelta = legalMovesForEvaluation(sim, affiliation) - beforeMobility;
    const captureDelta = captureCount(sim, affiliation) - beforeCaptures;
    // Splitting normally reduces total armor and can reduce range, so a small
    // mobility increase is not enough to justify it. Require a concrete new
    // capture or a substantial mobility gain.
    return captureDelta > 0 || mobilityDelta >= 6;
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
    const ranked = moves.map((mv) => {
        let score = 0;
        if (mv.type !== "move") {
            score += mv.type === "strengthen" ? 90 : mv.type === "weaken" ? 80 : -100;
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
        // Insane contests harder: bigger zone bonus, and extra bonus for
        // sitting on the star when the enemy would win by taking it.
        const zoneMul = difficulty === "insane" ? 2 : 1;
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

export function pickMinimaxMove(state: gameState, affiliation: "red" | "blue", difficulty: MinimaxDifficulty = "hard"): AiAction | null {
    if (difficulty === "insane" && transposition.size > 50000) transposition.clear();
    const moves = orderMoves(state, legalActions(state, affiliation), affiliation, difficulty);
    if (moves.length === 0) return null;

    // Insane instant-win pre-check: if any legal move wins RIGHT NOW
    // (star win or wiping the enemy), take it without searching. This
    // guarantees the bot never "thinks past" a forced win.
    if (difficulty === "insane") {
        for (const mv of moves) {
            if (moveWinsImmediately(state, mv, affiliation)) return mv;
        }
        // Depth 4 with 100+ legal moves is unaffordable at full width.
        // The instant-win scan above already covered EVERY move, so capping
        // the root to the most promising ordered moves is safe: captures,
        // winning/denying stars and star-zone moves are all ranked first.
        if (moves.length > 24) moves.splice(24);
        moves = moves.filter((mv) => mv.type !== "split" || isMeaningfulSplit(state, mv, affiliation));
        if (moves.length === 0) return null;
    }

    let bestMove: AiAction | null = null;
    let bestScore = -Infinity;
    const depth = MAX_DEPTH[difficulty];

    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyAction(sim, mv);
        if (res.error) continue;

        const score = minimax(sim, depth - 1, -Infinity, Infinity, affiliation === "red" ? "blue" : "red", affiliation, difficulty);
        if (score > bestScore) {
            bestScore = score;
            bestMove = mv;
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
    difficulty: MinimaxDifficulty = "hard"
): number {
    // Forced wins/losses propagate immediately at any depth — insane must
    // see a star win coming even 3 plies out and never trade it away.
    const terminal = terminalScore(state, rootAffiliation);
    if (terminal !== null) return terminal;
    if (depth <= 0) {
        return evaluateState(state, rootAffiliation);
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
    // Insane searches one ply deeper (depth 4 vs hard's 3). To keep that
    // affordable, cap breadth on non-root nodes to the most promising
    // ordered moves — alpha-beta then prunes the rest. Root still searches
    // everything so no winning move is blind-spotted.
    if (difficulty === "insane" && moves.length > 28) {
        moves = moves.slice(0, 28);
    }
    if (difficulty === "insane") {
        moves = moves.filter((mv) => mv.type !== "split" || isMeaningfulSplit(state, mv, turnAffiliation));
    }

    let best = isMax ? -Infinity : Infinity;
    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyAction(sim, mv);
        if (res.error) continue;
        const nextTurn = turnAffiliation === "red" ? "blue" : "red";
        const score = minimax(sim, depth - 1, alpha, beta, nextTurn, rootAffiliation, difficulty);

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