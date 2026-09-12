// Tests for the effect functions in assets/effects.ts
// Only the exported functions can be tested: splitEffect, weakenEffect,
// strengthenPiece, and checkOccupation.
import { describe, it, expect } from "vitest";
import { splitEffect, weakenEffect, strengthenPiece, checkOccupation } from "../assets/effects";
import { createGridBoard, makePiece, makeGame, placePiece } from "./helpers";

describe("splitEffect()", () => {
    // --- Turn validation ---
    it("returns an error when it is not the piece's turn", () => {
        const game = makeGame();
        const piece = makePiece({ affiliation: "red", strength: 2 });
        const result = splitEffect(piece, game.board, game);
        expect(result).toBe("Can't split piece, that is not yours");
    });

    // --- Split by strength value ---
    it("splits a strength-2 piece into strength 1 with halved armor and range", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 4, range: 2 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        // Original piece is halved.
        expect(piece.strength).toBe(1);
        expect(piece.armor).toBe(2);
        expect(piece.range).toBe(1);
        // A new piece was created on an adjacent square.
        expect(game.bluePieces.length).toBeGreaterThan(0);
    });

    it("rounds a split range down and never creates a decimal range", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 4, range: 3 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        expect(piece.range).toBe(1);
        expect(Number.isInteger(piece.range)).toBe(true);
        const created = game.bluePieces.find((candidate) => candidate !== piece);
        expect(created?.range).toBe(1);
        expect(Number.isInteger(created?.range)).toBe(true);
    });

    it("splits a strength-4 piece into strength 2", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 4, armor: 4, range: 4 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        expect(piece.strength).toBe(2);
        expect(piece.armor).toBe(2);
        expect(piece.range).toBe(2);
    });

    it("splits a strength-6 piece into strength 3", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 6, armor: 4, range: 6 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        expect(piece.strength).toBe(3);
        expect(piece.armor).toBe(2);
        expect(piece.range).toBe(3);
    });

    it("splits a strength-8 piece into strength 4", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 8, armor: 4, range: 8 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        expect(piece.strength).toBe(4);
        expect(piece.armor).toBe(2);
        expect(piece.range).toBe(4);
    });

    // --- Non-splittable strength ---
    it("returns an error for a strength value that cannot be split (odd numbers)", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 4, range: 3 });
        placePiece(board, piece);

        const result = splitEffect(piece, board, game);

        expect(result).toBe("Piece cannot be split");
        // Piece unchanged.
        expect(piece.strength).toBe(3);
    });

    it("returns an error for strength 1 (cannot be split)", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, armor: 4, range: 1 });
        placePiece(board, piece);

        const result = splitEffect(piece, board, game);

        expect(result).toBe("Piece cannot be split");
    });

    // --- New piece placement ---
    it("creates a new piece on an adjacent empty square", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 4, range: 2 });
        placePiece(board, piece);

        splitEffect(piece, board, game);

        // The new piece should be on one of the 8 adjacent squares.
        const adjacentKeys = [
            "0,0", "1,0", "2,0",
            "0,1", "2,1",
            "0,2", "1,2", "2,2",
        ];
        const created = adjacentKeys.some((key) => board[key].tenant !== null);
        expect(created).toBe(true);
    });

    it("does not create a new piece when all adjacent squares are occupied", () => {
        const board = createGridBoard(4, 4);
        // Occupy all 8 squares around (1,1).
        const occupiedKeys = ["0,0", "1,0", "2,0", "0,1", "2,1", "0,2", "1,2", "2,2"];
        for (const key of occupiedKeys) {
            board[key] = { occupied: true, bricked: false, tenant: makePiece({ position: [0, 0] }) };
        }
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 4, range: 2 });
        placePiece(board, piece);

        const result = splitEffect(piece, board, game);

        // No new piece created, and the failed effect is completely atomic.
        expect(game.bluePieces.length).toBe(0);
        expect(result).toBe("No valid position to create piece");
        expect(piece).toMatchObject({ strength: 2, armor: 4, range: 2 });
    });

    it("does not overwrite a star when choosing a split square", () => {
        const board = createGridBoard(3, 3);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 4, range: 2 });
        placePiece(board, piece);
        board["1,0"]!.star = true; // first candidate (north)

        const result = splitEffect(piece, board, game);

        expect(result).toBe("Piece created");
        expect(board["1,0"]!.star).toBe(true);
        expect(board["1,0"]!.tenant).toBeNull();
        expect(board["1,2"]!.tenant).not.toBeNull(); // next candidate (south)
    });
});

describe("weakenEffect()", () => {
    it("returns an error when the piece is invulnerable (all stats at 1)", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, armor: 1, range: 1 });
        placePiece(board, piece);

        const result = weakenEffect(piece, game);

        expect(result).toBe("Piece is invulnerable");
    });

    it("reduces strength, armor, and range by 1", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 5, armor: 5, range: 5 });
        placePiece(board, piece);

        const result = weakenEffect(piece, game);

        expect(result).toBe("Piece weakened");
        const weakened = board["1,1"].tenant;
        expect(weakened?.strength).toBe(4);
        expect(weakened?.armor).toBe(4);
        expect(weakened?.range).toBe(4);
    });

    it("does not reduce any stat below 1", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        // strength 1, armor 2, range 1 => only armor can be reduced.
        const piece = makePiece({ position: [1, 1], strength: 1, armor: 2, range: 1 });
        placePiece(board, piece);

        weakenEffect(piece, game);

        const weakened = board["1,1"].tenant;
        expect(weakened?.strength).toBe(1);
        expect(weakened?.armor).toBe(1);
        expect(weakened?.range).toBe(1);
    });

    it("works on enemy pieces (affiliation-agnostic)", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 5, armor: 5, range: 5, affiliation: "red" });
        placePiece(board, piece);

        const result = weakenEffect(piece, game);

        expect(result).toBe("Piece weakened");
        expect(board["1,1"].tenant?.strength).toBe(4);
    });

    // Regression: weakenEffect used to create a NEW piece object for the board
    // but never update the affiliation array (bluePieces/redPieces). The old
    // piece (with original stats) survived in the array, so on the next turn
    // the piece "regained" its stats. These tests pin the sync behavior.
    it("keeps the bluePieces array in sync after weakening", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 5, armor: 5, range: 5 });
        placePiece(board, piece);
        game.bluePieces = [piece];

        weakenEffect(piece, game);

        const tracked = game.bluePieces[0]!;
        expect(tracked.strength).toBe(4);
        expect(tracked.armor).toBe(4);
        expect(tracked.range).toBe(4);
        // The array must reference the SAME object the board uses, so there is
        // exactly one source of truth.
        expect(tracked).toBe(board["1,1"].tenant);
    });

    it("keeps the redPieces array in sync after weakening", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 6, armor: 6, range: 6, affiliation: "red" });
        placePiece(board, piece);
        game.redPieces = [piece];

        weakenEffect(piece, game);

        const tracked = game.redPieces[0]!;
        expect(tracked.strength).toBe(5);
        expect(tracked).toBe(board["1,1"].tenant);
    });
});

describe("strengthenPiece()", () => {
    it("returns an error when the piece is already at max strength (8)", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 8, armor: 5, range: 5 });
        placePiece(board, piece);

        const result = strengthenPiece(piece, game);

        expect(result).toBe("Piece cannot be strengthened further");
    });

    it("doubles strength (capped at 8) and reduces armor by the strength gained", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        // strength 3 => increase to 6, gained 3, armor 5 - 3 = 2.
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 5, range: 5 });
        placePiece(board, piece);

        const result = strengthenPiece(piece, game);

        expect(result).toBe("Piece strengthened");
        const strengthened = board["1,1"].tenant;
        expect(strengthened?.strength).toBe(6);
        expect(strengthened?.armor).toBe(2);
    });

    it("caps strength at 8", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        // strength 5 => 2*5 = 10, capped at 8, gained 3, armor 5 - 3 = 2.
        const piece = makePiece({ position: [1, 1], strength: 5, armor: 5, range: 5 });
        placePiece(board, piece);

        strengthenPiece(piece, game);

        const strengthened = board["1,1"].tenant;
        expect(strengthened?.strength).toBe(8);
        expect(strengthened?.armor).toBe(2);
    });

    it("does not reduce armor below 0", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        // strength 4 => increase to 8, gained 4, armor 2 - 4 = -2 => clamped to 0.
        const piece = makePiece({ position: [1, 1], strength: 4, armor: 2, range: 5 });
        placePiece(board, piece);

        strengthenPiece(piece, game);

        const strengthened = board["1,1"].tenant;
        expect(strengthened?.strength).toBe(8);
        expect(strengthened?.armor).toBe(0);
    });

    it("works on enemy pieces (affiliation-agnostic)", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 5, range: 5, affiliation: "red" });
        placePiece(board, piece);

        const result = strengthenPiece(piece, game);

        expect(result).toBe("Piece strengthened");
        expect(board["1,1"].tenant?.strength).toBe(4);
    });

    // Regression: strengthenPiece had the same array-sync bug as weakenEffect.
    it("keeps the affiliation array in sync after strengthening", () => {
        const board = createGridBoard(2, 2);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 5, range: 5 });
        placePiece(board, piece);
        game.bluePieces = [piece];

        strengthenPiece(piece, game);

        const tracked = game.bluePieces[0]!;
        expect(tracked.strength).toBe(6);
        expect(tracked.armor).toBe(2);
        expect(tracked).toBe(board["1,1"].tenant);
    });
});

describe("checkOccupation()", () => {
    it("returns true when the square has a tenant", () => {
        const board = createGridBoard(2, 2);
        const piece = makePiece({ position: [1, 1] });
        placePiece(board, piece);
        expect(checkOccupation([1, 1], board)).toBe(true);
    });

    it("returns true when the square has a shard", () => {
        const board = createGridBoard(2, 2);
        board["1,1"] = { ...board["1,1"], shard: "armor" };
        expect(checkOccupation([1, 1], board)).toBe(true);
    });

    it("returns false when the square is empty", () => {
        const board = createGridBoard(2, 2);
        expect(checkOccupation([1, 1], board)).toBe(false);
    });

    it("throws when the square does not exist", () => {
        const board = createGridBoard(2, 2);
        expect(() => checkOccupation([9, 9], board)).toThrow();
    });
});