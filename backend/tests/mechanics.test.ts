// Tests for the bricking system in assets/mechanics.ts
import { describe, it, expect } from "vitest";
import { brickBoard } from "../assets/mechanics";
import { createGridBoard, makeGame } from "./helpers";

describe("brickBoard()", () => {
    it("does not brick before turn 20", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turnCount: 19 });

        const result = brickBoard(game);

        expect(result).toBeNull();
        expect(Object.values(board).some(s => s.bricked)).toBe(false);
    });

    it("bricks a square on turn 20", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turnCount: 20, bricks: 0 });

        const result = brickBoard(game);

        expect(result).toBe("Square bricked");
        expect(Object.values(board).filter(s => s.bricked).length).toBe(1);
        expect(game.bricks).toBe(1);
    });

    it("bricks at most one square per turn after turn 20", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turnCount: 21, bricks: 0 });

        brickBoard(game);
        brickBoard(game);

        expect(Object.values(board).filter(s => s.bricked).length).toBe(1);
        expect(game.bricks).toBe(1);
    });

    it("bricks one square on each subsequent turn", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turnCount: 20, bricks: 0 });

        brickBoard(game);
        game.turnCount = 21;
        brickBoard(game);

        expect(Object.values(board).filter(s => s.bricked).length).toBe(2);
    });

    it("bricks on unoccupied and unsharded squares only", () => {
        const board = createGridBoard(4, 4);
        // occupy one square and put a shard on another — neither should be bricked
        board["1,1"] = { occupied: true, bricked: false, tenant: null };
        board["2,2"] = { occupied: false, bricked: false, tenant: null, shard: "armor" };
        const game = makeGame({ board, turnCount: 20 });

        brickBoard(game);

        expect(board["1,1"]!.bricked).toBe(false);
        expect(board["2,2"]!.bricked).toBe(false);
        // one of the remaining 14 empty squares got bricked
        expect(Object.values(board).filter(s => s.bricked).length).toBe(1);
    });

    it("stops bricking once 80 squares are bricked", () => {
        // 9x9 board = 81 squares; pre-brick 80 of them
        const board = createGridBoard(9, 9);
        Object.keys(board).slice(0, 80).forEach(key => {
            board[key] = { occupied: false, bricked: true, tenant: null };
        });
        const game = makeGame({ board, turnCount: 50, bricks: 80 });

        const result = brickBoard(game);

        expect(result).toBeNull();
        // still only 80 bricked
        expect(Object.values(board).filter(s => s.bricked).length).toBe(80);
    });

    it("returns null on a fully bricked board instead of crashing", () => {
        const board = createGridBoard(2, 2);
        Object.keys(board).forEach(key => {
            board[key] = { occupied: false, bricked: true, tenant: null };
        });
        const game = makeGame({ board, turnCount: 50, bricks: 4 });

        const result = brickBoard(game);

        expect(result).toBeNull();
    });
});