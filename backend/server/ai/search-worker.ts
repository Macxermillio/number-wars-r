import { parentPort, workerData } from "worker_threads";
import type { gameState } from "../../assets/start.ts";
import type { Move } from "./simulation.ts";
import { pickHeuristicMove } from "./heuristic.ts";
import { pickMinimaxMove } from "./minimax.ts";

// ============================================================================
// Search worker — receives a serialized gameState, runs the requested search,
// posts back a move. Stateless: no rooms, no shared memory.
// ============================================================================

type Difficulty = "easy" | "medium" | "hard" | "insane";

// Message from main thread:
// { id, state, difficulty, affiliation }
interface WorkerRequest {
    id: number;
    state: gameState;
    difficulty: Difficulty;
    affiliation: "red" | "blue";
}

function chooseMove(state: gameState, difficulty: Difficulty, affiliation: "red" | "blue"): Move | null {
    switch (difficulty) {
        case "easy":
        case "medium":
            return pickHeuristicMove(state, affiliation, difficulty === "easy" ? "easy" : "medium");
        case "hard":
            return pickMinimaxMove(state, affiliation, "hard");
        case "insane":
            return pickMinimaxMove(state, affiliation, "insane");
    }
}

if (parentPort) {
    parentPort.on("message", (req: WorkerRequest) => {
        try {
            const move = chooseMove(req.state, req.difficulty, req.affiliation);
            parentPort!.postMessage({ id: req.id, move });
        } catch (err: any) {
            parentPort!.postMessage({ id: req.id, move: null, error: err?.message || String(err) });
        }
    });
}

// If this file is run directly (for testing), just log.
if (!parentPort) {
    console.log("[search-worker] running standalone (no parent port)");
}