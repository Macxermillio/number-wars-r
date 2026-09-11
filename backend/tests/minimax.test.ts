import { describe, expect, it } from "vitest";
import { isMeaningfulSplit } from "../server/ai/minimax";
import { createGameBoard, makeGame, makePiece, placePiece } from "./helpers";

describe("Insane split action selection", () => {
    it("rejects a split when it creates no material, mobility, or capture benefit", () => {
        const board = createGameBoard();
        const game = makeGame({ board, turn: "red", turnEffect: "Split" });
        const piece = makePiece({ affiliation: "red", position: [28, 7], strength: 2, armor: 8, range: 2 });
        placePiece(board, piece);
        game.redPieces.push(piece);

        expect(isMeaningfulSplit(game, { type: "split", target: [28, 7] }, "red")).toBe(false);
    });
});