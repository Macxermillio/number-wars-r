// Quick sanity check for the computer opponent bots.
// Run: npx tsx smoke-computer.ts
import startGame from "./assets/start.ts";
import { chooseTurnEffect } from "./assets/mechanics.ts";
import { pickHeuristicMove } from "./server/ai/heuristic.ts";
import { pickMinimaxMove } from "./server/ai/minimax.ts";
import { legalMoves, applyMove, cloneState } from "./server/ai/simulation.ts";

function freshState() {
    const s = startGame() as any;
    s.turnEffect = "Merge";
    return s;
}

// 1. Legal move generation works.
const s1 = freshState();
const redMoves = legalMoves(s1, "red");
console.log("[1] red legal moves on fresh board:", redMoves.length);
if (redMoves.length === 0) throw new Error("no red moves");

// 2. Applying a legal move works and flips the turn.
const s2 = cloneState(s1);
const mv = redMoves[0]!;
const res = applyMove(s2, mv);
console.log("[2] applyMove result:", res.result || res.error);
if (res.error) throw new Error("legal move rejected: " + res.error);

// 3. Heuristic bot always returns a legal move.
const s3 = freshState();
const opt = pickHeuristicMove(s3, "red", "medium")!;
const sim3 = cloneState(s3);
const r3 = applyMove(sim3, opt);
console.log("[3] heuristic pick:", opt, "->", r3.result || r3.error);
if (r3.error) throw new Error("heuristic produced illegal move: " + r3.error);

// 4. Minimax bot returns a legal move (depth 3, should be fast on small board).
const s4 = freshState();
const mm = pickMinimaxMove(s4, "red", "hard")!;
const sim4 = cloneState(s4);
const r4 = applyMove(sim4, mm);
console.log("[4] minimax pick:", mm, "->", r4.result || r4.error);
if (r4.error) throw new Error("minimax produced illegal move: " + r4.error);

// 5. Merge turn: both bots should sometimes merge (or at least never error).
const s5 = freshState();
s5.turnEffect = "Merge";
const mm5 = pickMinimaxMove(s5, "red", "hard")!;
const sim5 = cloneState(s5);
const r5 = applyMove(sim5, mm5);
console.log("[5] minimax on Merge turn:", mm5, "->", r5.result || r5.error);
if (r5.error) throw new Error("minimax merge illegal: " + r5.error);

// 6. Evaluate a terminal state (game over) doesn't blow up.
const s6 = freshState() as any;
s6.redPieces = [];
s6.bluePieces = [s6.bluePieces[0]];
// evaluateState requires the arrays to match board, but the function only
// reads piece lists, so it's safe for the check.
const score = (await import("./server/ai/simulation.ts")).evaluateState(s6, "red");
console.log("[6] terminal eval (red no pieces):", score);
if (score !== -10000) throw new Error("terminal eval wrong");

console.log("\nAll computer-bot sanity checks passed ✅");
process.exit(0);