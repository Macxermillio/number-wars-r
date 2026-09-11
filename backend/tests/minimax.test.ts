import { describe, expect, it } from "vitest";
import { isMeaningfulSplit, pickMinimaxMove } from "../server/ai/minimax";
import { pickHeuristicMove } from "../server/ai/heuristic";
import { applyAction, applyMove, cloneState, isWellFormedAiAction } from "../server/ai/simulation";
import { createGameBoard, makeGame, makePiece, placePiece } from "./helpers";

describe("Insane split action selection", () => {
    it("rejects a split when it creates no capture, mobility, or star benefit", () => {
        const board = createGameBoard();
        const game = makeGame({ board, turn: "red", turnEffect: "Split" });
        const piece = makePiece({ affiliation: "red", position: [28, 7], strength: 2, armor: 8, range: 2 });
        placePiece(board, piece);
        game.redPieces.push(piece);

        expect(isMeaningfulSplit(game, { type: "split", target: [28, 7] }, "red")).toBe(false);
    });

    it("keeps a mobility split that opens a new capture", () => {
        const board = createGameBoard();
        const game = makeGame({ board, turn: "red", turnEffect: "Split", starTurn: 999 });
        const splitter = makePiece({ affiliation: "red", position: [28, 7], strength: 8, armor: 2, range: 8 });
        const victim = makePiece({ affiliation: "blue", position: [28, 5], strength: 1, armor: 1, range: 1 });
        placePiece(board, splitter);
        placePiece(board, victim);
        game.redPieces.push(splitter);
        game.bluePieces.push(victim);

        expect(isMeaningfulSplit(game, { type: "split", target: [28, 7] }, "red")).toBe(true);
    });

    it("prefers a live star grab over a quiet move", () => {
        const board = createGameBoard();
        const game = makeGame({ board, turn: "red", turnEffect: "Merge", starTurn: 999 });
        const hunter = makePiece({ affiliation: "red", position: [28, 5], strength: 2, armor: 8, range: 2 });
        const bystander = makePiece({ affiliation: "blue", position: [36, 13], strength: 1, armor: 1, range: 1 });
        placePiece(board, hunter);
        placePiece(board, bystander);
        board["28,7"]!.star = true;
        game.redPieces.push(hunter);
        game.bluePieces.push(bystander);

        const move = pickMinimaxMove(game, "red", "insane");
        expect(move).toEqual({ type: "move", from: [28, 5], to: [28, 7] });
    });
});

describe("Computer bot payload regression (Railway crash)", () => {
    function redGame() {
        const board = createGameBoard();
        const game = makeGame({ board, turn: "red", turnEffect: "Merge" });
        const red = makePiece({ affiliation: "red", position: [28, 7], strength: 2, armor: 8, range: 2 });
        const blue = makePiece({ affiliation: "blue", position: [36, 13], strength: 1, armor: 1, range: 1 });
        placePiece(board, red);
        placePiece(board, blue);
        game.redPieces.push(red);
        game.bluePieces.push(blue);
        return game;
    }

    it("heuristic easy/medium return a well-formed AiAction with type + coords", () => {
        for (const difficulty of ["easy", "medium"] as const) {
            const game = redGame();
            const move = pickHeuristicMove(game, "red", difficulty);
            expect(move).not.toBeNull();
            expect(isWellFormedAiAction(move)).toBe(true);
            expect(move!.type).toBe("move");
            // The exact dispatch that crashed in triggerComputerMove
            // (main.ts:603 — move.target[0] on a typeless payload).
            if (move!.type === "move") {
                expect(move!.from[0]).toBeTypeOf("number");
                expect(move!.to[0]).toBeTypeOf("number");
            }
        }
    });

    it("heuristic picks apply cleanly through the shared pipeline", () => {
        for (const difficulty of ["easy", "medium"] as const) {
            const game = redGame();
            const move = pickHeuristicMove(game, "red", difficulty)!;
            const sim = cloneState(game);
            expect(applyAction(sim, move).error).toBeUndefined();
        }
    });

    it("rejects the legacy bare {from,to} payload that caused the crash", () => {
        const game = redGame();
        const legacy = { from: [28, 7], to: [28, 6] } as unknown;
        expect(isWellFormedAiAction(legacy)).toBe(false);
        // applyMove still accepts the bare shape (simulation-level), but the
        // server pipeline must never receive it without `type`.
        expect(applyMove(cloneState(game), legacy as { from: [number, number]; to: [number, number] }).error).toBeUndefined();
    });

    it("rejects effect actions with missing target coords", () => {
        expect(isWellFormedAiAction({ type: "split" })).toBe(false);
        expect(isWellFormedAiAction({ type: "weaken", target: undefined })).toBe(false);
        expect(isWellFormedAiAction({ type: "move", from: [28, 7] })).toBe(false);
        expect(isWellFormedAiAction(null)).toBe(false);
    });
});