import type { gameState } from "../../assets/start.ts";
import type { Move } from "./simulation.ts";
import { legalMoves, cloneState, applyMove, evaluateState, distToStarFocus } from "./simulation.ts";

// ============================================================================
// Hard-mode Computer opponent: minimax search with alpha-beta pruning and
// move ordering by capture/shard/merge/star-zone value. Plays red (or any affiliation).
// ===========================================================================

export type MinimaxDifficulty = "hard";

const MAX_DEPTH: Record<MinimaxDifficulty, number> = {
    hard: 3,
};

// Order moves so likely-good ones (captures, star pickups, star-zone
// positioning, shard pickups, merges) come first — this makes alpha-beta
// prune much more effectively.
function orderMoves(state: gameState, moves: Move[], affiliation: "red" | "blue"): Move[] {
    const starKey = (Object.entries(state.board) as [string, { star?: boolean }][]).find(([, sq]) => sq.star === true)?.[0];
    const starPos = starKey ? starKey.split(",").map(Number) as [number, number] : null;
    const ranked = moves.map((mv) => {
        let score = 0;
        const to = state.board[`${mv.to[0]},${mv.to[1]}`];
        if (to?.tenant) {
            if (to.tenant.affiliation !== affiliation) score += 1000; // capture
            else score += 50; // merge
        } else if (to?.star) {
            score += 800; // star pickup — alternate win condition
        } else if (to?.shard) {
            score += 30; // shard pickup
        }
        // Star-zone contest: prefer moves that land on/near the live star,
        // or (no star on board) near the hot-zone squares where the next
        // star will spawn, so positional moves are searched first.
        if (starPos) {
            const d = Math.abs(mv.to[0] - starPos[0]) + Math.abs(mv.to[1] - starPos[1]);
            score += Math.max(0, 12 - d) * 6;
        } else {
            const d = distToStarFocus(mv.to[0], mv.to[1]);
            if (d <= 5) score += (6 - d) * 5;
        }
        return { mv, score };
    });
    ranked.sort((a, b) => b.score - a.score);
    return ranked.map((r) => r.mv);
}

export function pickMinimaxMove(state: gameState, affiliation: "red" | "blue", difficulty: MinimaxDifficulty = "hard"): Move | null {
    const moves = orderMoves(state, legalMoves(state, affiliation), affiliation);
    if (moves.length === 0) return null;

    let bestMove: Move | null = null;
    let bestScore = -Infinity;
    const depth = MAX_DEPTH[difficulty];

    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyMove(sim, mv);
        if (res.error) continue;

        const score = minimax(sim, depth - 1, -Infinity, Infinity, affiliation === "red" ? "blue" : "red", affiliation);
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
    rootAffiliation: "red" | "blue"
): number {
    if (depth <= 0) {
        return evaluateState(state, rootAffiliation);
    }

    const isMax = turnAffiliation === rootAffiliation;
    const moves = orderMoves(state, legalMoves(state, turnAffiliation), turnAffiliation);
    if (moves.length === 0) {
        // No legal moves: evaluate as-is (very rare — pinned pieces; treated
        // as a pass).
        return evaluateState(state, rootAffiliation);
    }

    let best = isMax ? -Infinity : Infinity;
    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyMove(sim, mv);
        if (res.error) continue;
        const nextTurn = turnAffiliation === "red" ? "blue" : "red";
        const score = minimax(sim, depth - 1, alpha, beta, nextTurn, rootAffiliation);

        if (isMax) {
            best = Math.max(best, score);
            alpha = Math.max(alpha, best);
        } else {
            best = Math.min(best, score);
            beta = Math.min(beta, best);
        }
        if (beta <= alpha) break; // prune
    }

    return best;
}