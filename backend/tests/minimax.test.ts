import { describe, expect, it } from "vitest";
import { isMeaningfulSplit, pickMinimaxMove } from "../server/ai/minimax";
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