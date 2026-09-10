import type { gameState } from "../../assets/start.ts";
import type { Move } from "./simulation.ts";
import { legalMoves, cloneState, applyMove, evaluateState } from "./simulation.ts";

// ============================================================================
// Easy-mode Computer opponent: a greedy 1-ply heuristic search.
// For every legal move it simulates the result and scores it; it picks the
// best. Difficulty comes from adding noise: a "casual" difficulty adds random
// jitter so it plays weak-but-legal; "normal" plays greedily-correct.
// ============================================================================

export type HeuristicDifficulty = "easy" | "medium";

// Pick the best move for `affiliation` under a heuristic.
// - difficulty "easy": adds large random jitter (plays loosely, still legal)
// - difficulty "medium": greedy best (1-ply)
export function pickHeuristicMove(state: gameState, affiliation: "red" | "blue", difficulty: HeuristicDifficulty = "medium"): Move | null {
    const moves = legalMoves(state, affiliation);
    if (moves.length === 0) return null;

    let best: Move | null = null;
    let bestScore = -Infinity;

    for (const mv of moves) {
        const sim = cloneState(state);
        const res = applyMove(sim, mv);
        if (res.error) continue; // skip illegal (shouldn't happen with legalMoves)

        let score = evaluateState(sim, affiliation);
        // Easy mode: add heavy noise so it makes mistakes.
        if (difficulty === "easy") {
            score += Math.random() * 40 - 20; // ±20 jitter
        }

        if (score > bestScore) {
            bestScore = score;
            best = mv;
        }
    }

    return best;
}