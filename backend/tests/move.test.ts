// Tests for the move/capture logic in assets/pieces.ts
import { describe, it, expect } from "vitest";
import {
    move,
    capture,
    validateMove,
    checkValidTurn,
    checkBricked,
    checkShard,
    checkAllyPieceOccupation,
} from "../assets/pieces";
import { createGridBoard, makePiece, makeGame, placePiece, makeSquare } from "./helpers";

describe("move()", () => {
    // --- Destination existence ---
    it("returns an error when the destination square does not exist on the board", () => {
        // Board is 4x4 (0..3), so (9,9) is off the board.
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = move([9, 9], piece, game);

        expect(result).toBe("Destination square does not exist on the board.");
    });

    // --- Turn validation ---
    it("returns an error when it is not the piece's turn (red tries to move first)", () => {
        // No moves have been made yet, so blue always moves first.
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], affiliation: "red", strength: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("It's not your turn.");
    });

    it("allows the other side to move after blue has moved", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        // Simulate that blue already moved by recording it in history.
        game.gameHistory.push({ turn: 0, event: "Piece moved", player: "blue" });
        const piece = makePiece({ position: [1, 1], affiliation: "red", strength: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece moved successfully");
    });

    // --- Direction rules ---
    it("returns an error when a straight-line piece (strength >= 5) tries to move diagonally", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        // strength 5 => straight lines only; (2,2) is diagonal from (1,1).
        const piece = makePiece({ position: [1, 1], strength: 5, range: 3 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece can only move in straight lines");
    });

    it("allows a queen piece (strength < 5) to move in a straight line (queens move all 8)", () => {
            const game = makeGame({ board: createGridBoard(4, 4) });
            // strength 1 => queen, can move straight or diagonal. (1,2) is straight from (1,1).
            const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

            const result = move([1, 2], piece, game);

            expect(result).toBe("Piece moved successfully");
        });

    // --- Range validation ---
    it("returns an error when the destination is farther than the piece's range", () => {
        const game = makeGame({ board: createGridBoard(6, 6) });
        // range 1, but (3,3) is distance 2 away.
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = move([3, 3], piece, game);

        expect(result).toBe("Piece can't move that far");
    });

    // --- Path obstruction ---
    it("returns an error when an intermediate square on the path is bricked", () => {
        const board = createGridBoard(6, 6);
        // Brick the intermediate square (2,2) between (1,1) and (3,3).
        board["2,2"] = { occupied: false, bricked: true, tenant: null };
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

        const result = move([3, 3], piece, game);

        expect(result).toBe("Path is obstructed, choose another destination.");
    });

    it("returns an error when an intermediate square on the path is occupied", () => {
        const board = createGridBoard(6, 6);
        // Occupy the intermediate square (2,2).
        const blocker = makePiece({ position: [2, 2], strength: 1, range: 1 });
        placePiece(board, blocker);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

        const result = move([3, 3], piece, game);

        expect(result).toBe("Path is obstructed, choose another destination.");
    });

    // --- Destination checks ---
    it("returns an error when the destination square is bricked", () => {
        const board = createGridBoard(4, 4);
        board["2,2"] = makeSquare({ bricked: true });
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Destination square is bricked");
    });

    it("returns an error when the destination square is occupied by an ally piece", () => {
        const board = createGridBoard(4, 4);
        const ally = makePiece({ position: [2, 2], strength: 1, range: 1 });
        placePiece(board, ally);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Destination square is occupied by an ally piece");
    });

    it("captures an enemy piece when moving onto an enemy-occupied square", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 1, armor: 1, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // strength 3 (diagonal mover) beats enemy effective health (1 armor + 1 strength = 2).
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece captured");
        expect(piece.position).toEqual([2, 2]);
        expect(board["2,2"]!.tenant).toBe(piece);
        expect(game.redPieces).not.toContain(enemy);
    });

    // --- Shard pickup ---
    it("picks up an armor shard and increases the piece's armor", () => {
        const board = createGridBoard(4, 4);
        board["2,2"] = { occupied: false, bricked: false, shard: "armor", tenant: null };
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, armor: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece moved successfully");
        expect(piece.armor).toBe(2);
        expect(board["2,2"]!.shard).toBeUndefined();
    });

    it("picks up a spike shard and increases the piece's spike count", () => {
        const board = createGridBoard(4, 4);
        board["2,2"] = makeSquare({ shard: "spike" });
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, spike: 0, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece moved successfully");
        expect(piece.spike).toBe(1);
        expect(board["2,2"]!.shard).toBeUndefined();
    });

    it("consumes a spike shard even when the piece is already at its cap", () => {
        const board = createGridBoard(4, 4);
        board["2,2"] = makeSquare({ shard: "spike" });
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 8, spike: 2, range: 1 });
        board["1,1"] = makeSquare({ occupied: true, tenant: piece });

        const result = move([1, 2], piece, game);

        expect(result).toBe("Piece moved successfully");
        expect(piece.spike).toBe(2);
        expect(board["1,2"]!.shard).toBeUndefined();
    });

    // --- Successful move ---
    it("moves the piece, updates the board, history, and turn", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = move([2, 2], piece, game);

        expect(result).toBe("Piece moved successfully");
        // Piece position updated.
        expect(piece.position).toEqual([2, 2]);
        // Old square cleared.
        expect(board["1,1"]!.tenant).toBeNull();
        expect(board["1,1"]!.occupied).toBe(false);
        // New square occupied.
        expect(board["2,2"]!.tenant).toBe(piece);
        expect(board["2,2"]!.occupied).toBe(true);
        // History and turn updated.
        expect(game.turnCount).toBe(1);
        expect(game.turn).toBe("red");
        expect(game.gameHistory[game.gameHistory.length - 1]!.player).toBe("blue");
    });
});

describe("capture()", () => {
    // --- Attacker dies to spikes ---
    it("kills the attacker when enemy spikes exceed the attacker's armor + strength", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 1, armor: 1, spike: 3, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // Attacker: strength 1, armor 1. Spike damage 3 => armor 0, strength -1 => dies.
        const piece = makePiece({ position: [1, 1], strength: 1, armor: 1, spike: 0, range: 1 });
        placePiece(board, piece);

        const result = capture([2, 2], piece, game);

        expect(result).toBe("Piece died to spikes");
        // Attacker removed from board.
        expect(board["1,1"]!.tenant).toBeNull();
        expect(game.bluePieces).not.toContain(piece);
        // Enemy consumed some spikes: original armor+strength = 2, so 3-2 = 1.
        expect(enemy.spike).toBe(1);
    });

    // --- Outright capture (no spikes) ---
    it("captures the enemy outright when strength exceeds its effective health", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 1, armor: 1, spike: 0, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // strength 5 > effective health (1 armor + 1 strength = 2).
        const piece = makePiece({ position: [1, 1], strength: 5, armor: 1, spike: 0, range: 1 });
        placePiece(board, piece);

        const result = capture([2, 2], piece, game);

        expect(result).toBe("Piece captured");
        expect(piece.position).toEqual([2, 2]);
        expect(board["2,2"]!.tenant).toBe(piece);
        expect(game.redPieces).not.toContain(enemy);
    });

    // --- Break through armor but not enough to kill -> repel ---
    it("repels the attacker when it breaks armor but cannot kill the enemy", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 5, armor: 1, spike: 0, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // strength 3: effective health = 1+5 = 6, 3 not > 6.
        // attackArmor = 1 - 3 = -2 < 0, leftoverPower = 3 - 1 = 2 < enemyStrength 5 => repel.
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 1, spike: 0, range: 1 });
        placePiece(board, piece);

        const result = capture([2, 2], piece, game);

        expect(result).toBe("Piece repelled");
        // Enemy strength reduced by leftover power: 5 - 2 = 3.
        expect(enemy.strength).toBe(3);
        expect(enemy.armor).toBe(0);
        // Attacker bounced back to its original square.
        expect(piece.position).toEqual([1, 1]);
        expect(board["1,1"]!.tenant).toBe(piece);
    });

    it("leaves an equal-armored 8 attacker at strength 8 and reduces the defender to strength 2", () => {
        const board = createGridBoard(4, 4);
        const defender = makePiece({ position: [2, 2], strength: 8, armor: 2, spike: 0, affiliation: "red" });
        const attacker = makePiece({ position: [1, 1], strength: 8, armor: 2, spike: 0, range: 1 });
        placePiece(board, defender);
        placePiece(board, attacker);
        const game = makeGame({ board });

        const result = capture([2, 2], attacker, game);

        expect(result).toBe("Piece repelled");
        expect(attacker.strength).toBe(8);
        expect(attacker.armor).toBe(2);
        expect(defender.strength).toBe(2);
        expect(defender.armor).toBe(0);
        expect(attacker.position).toEqual([1, 1]);
        expect(board["1,1"]!.tenant).toBe(attacker);
        expect(board["2,2"]!.tenant).toBe(defender);
    });

    // --- Break through armor and kill -> capture (second path) ---
    it("captures the enemy when leftover power is enough to kill it", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 2, armor: 1, spike: 0, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // strength 3 == enemyArmor(1) + enemyStrength(2) => not outright capture.
        // attackArmor = 1 - 3 = -2 < 0, leftoverPower = 3 - 1 = 2 >= enemyStrength 2 => capture.
        const piece = makePiece({ position: [1, 1], strength: 3, armor: 1, spike: 0, range: 1 });
        placePiece(board, piece);

        const result = capture([2, 2], piece, game);

        expect(result).toBe("Piece captured");
        expect(piece.position).toEqual([2, 2]);
        expect(board["2,2"]!.tenant).toBe(piece);
        expect(game.redPieces).not.toContain(enemy);
    });

    it("does not increase the attacker's strength when capturing a weaker piece", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 5, armor: 0, spike: 0, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        const attacker = makePiece({ position: [1, 1], strength: 7, armor: 1, spike: 0, range: 1 });
        placePiece(board, attacker);

        const result = capture([2, 2], attacker, game);

        expect(result).toBe("Piece captured");
        expect(attacker.strength).toBe(7);
        expect(board["2,2"]!.tenant).toBe(attacker);
    });

    // --- Does not break through armor -> bounce off armor ---
    it("bounces the attacker off when it cannot break through the enemy's armor", () => {
        const board = createGridBoard(4, 4);
        const enemy = makePiece({ position: [2, 2], strength: 3, armor: 3, spike: 0, affiliation: "red" });
        placePiece(board, enemy);
        const game = makeGame({ board });
        // strength 2: effective health = 3+3 = 6, 2 > 6? No.
        // attackArmor = 3 - 2 = 1 >= 0 => armor reduced, bounce back.
        const piece = makePiece({ position: [1, 1], strength: 2, armor: 1, spike: 0, range: 1 });
        placePiece(board, piece);

        const result = capture([2, 2], piece, game);

        expect(result).toBe("Piece bounced off armor");
        expect(enemy.armor).toBe(1);
        expect(piece.position).toEqual([1, 1]);
        expect(board["1,1"]!.tenant).toBe(piece);
    });
});

describe("checkValidTurn()", () => {
    it("returns true for blue when no moves have been made yet", () => {
        const game = makeGame();
        const piece = makePiece({ affiliation: "blue" });
        expect(checkValidTurn(piece, game)).toBe(true);
    });

    it("returns false for red when no moves have been made yet", () => {
        const game = makeGame();
        const piece = makePiece({ affiliation: "red" });
        expect(checkValidTurn(piece, game)).toBe(false);
    });

    it("returns false when the same player tries to move twice in a row", () => {
        const game = makeGame({ gameHistory: [{ turn: 0, event: "moved", player: "blue" }] });
        const piece = makePiece({ affiliation: "blue" });
        expect(checkValidTurn(piece, game)).toBe(false);
    });

    it("returns true when it is the other player's turn", () => {
        const game = makeGame({ gameHistory: [{ turn: 0, event: "moved", player: "blue" }] });
        const piece = makePiece({ affiliation: "red" });
        expect(checkValidTurn(piece, game)).toBe(true);
    });
});

describe("checkBricked()", () => {
    it("returns true when the square is bricked", () => {
        const board = createGridBoard(2, 2);
        board["1,1"] = makeSquare({ bricked: true });
        expect(checkBricked([1, 1], board)).toBe(true);
    });

    it("returns false when the square is not bricked", () => {
        const board = createGridBoard(2, 2);
        expect(checkBricked([1, 1], board)).toBe(false);
    });

    it("throws when the square does not exist", () => {
        const board = createGridBoard(2, 2);
        expect(() => checkBricked([9, 9], board)).toThrow();
    });
});

describe("checkShard()", () => {
    it("returns true when the square has a shard", () => {
        const board = createGridBoard(2, 2);
        board["1,1"] = makeSquare({ shard: "armor" });
        expect(checkShard([1, 1], board)).toBe(true);
    });

    it("returns false when the square has no shard", () => {
        const board = createGridBoard(2, 2);
        expect(checkShard([1, 1], board)).toBe(false);
    });

    it("throws when the square does not exist", () => {
        const board = createGridBoard(2, 2);
        expect(() => checkShard([9, 9], board)).toThrow();
    });
});

describe("checkAllyPieceOccupation()", () => {
    it("returns true when the square is occupied by an ally", () => {
        const board = createGridBoard(2, 2);
        const ally = makePiece({ position: [1, 1], affiliation: "blue" });
        placePiece(board, ally);
        const piece = makePiece({ affiliation: "blue" });
        expect(checkAllyPieceOccupation([1, 1], board, piece)).toBe(true);
    });

    it("returns false when the square is occupied by an enemy", () => {
        const board = createGridBoard(2, 2);
        const enemy = makePiece({ position: [1, 1], affiliation: "red" });
        placePiece(board, enemy);
        const piece = makePiece({ affiliation: "blue" });
        expect(checkAllyPieceOccupation([1, 1], board, piece)).toBe(false);
    });

    it("returns false when the square is empty", () => {
        const board = createGridBoard(2, 2);
        const piece = makePiece({ affiliation: "blue" });
        expect(checkAllyPieceOccupation([1, 1], board, piece)).toBe(false);
    });

    it("throws when the square does not exist", () => {
        const board = createGridBoard(2, 2);
        const piece = makePiece();
        expect(() => checkAllyPieceOccupation([9, 9], board, piece)).toThrow();
    });
});

describe("validateMove()", () => {
    // --- Destination existence ---
    it("returns an error when the destination square does not exist on the board", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = validateMove([9, 9], piece, game);

        expect(result).toBe("Destination square does not exist on the board.");
    });

    // --- Turn validation ---
    it("returns an error when it is not the piece's turn", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], affiliation: "red", strength: 1, range: 1 });

        const result = validateMove([2, 2], piece, game);

        expect(result).toBe("It's not your turn.");
    });

    // --- Direction rules ---
    it("returns an error when a straight-line piece (strength >= 5) tries to move diagonally", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], strength: 5, range: 3 });

        const result = validateMove([2, 2], piece, game);

        expect(result).toBe("Piece can only move in straight lines");
    });

    it("allows a queen piece (strength < 5) to move in a straight line (queens move all 8)", () => {
            const game = makeGame({ board: createGridBoard(4, 4) });
            const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

            const result = validateMove([1, 2], piece, game);

            expect(result).toBeNull();
        });

    // --- Range validation ---
    it("returns an error when the destination is farther than the piece's range", () => {
        const game = makeGame({ board: createGridBoard(6, 6) });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = validateMove([3, 3], piece, game);

        expect(result).toBe("Piece can't move that far");
    });

    // --- Path obstruction ---
    it("returns an error when an intermediate square on the path is bricked", () => {
        const board = createGridBoard(6, 6);
        board["2,2"] = { occupied: false, bricked: true, tenant: null };
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

        const result = validateMove([3, 3], piece, game);

        expect(result).toBe("Path is obstructed, choose another destination.");
    });

    it("returns an error when an intermediate square on the path is occupied", () => {
        const board = createGridBoard(6, 6);
        const blocker = makePiece({ position: [2, 2], strength: 1, range: 1 });
        placePiece(board, blocker);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 3 });

        const result = validateMove([3, 3], piece, game);

        expect(result).toBe("Path is obstructed, choose another destination.");
    });

    // --- Destination checks ---
    it("returns an error when the destination square is bricked", () => {
        const board = createGridBoard(4, 4);
        board["2,2"] = makeSquare({ bricked: true });
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = validateMove([2, 2], piece, game);

        expect(result).toBe("Destination square is bricked");
    });

    it("returns an error when the destination square is occupied by an ally piece", () => {
        const board = createGridBoard(4, 4);
        const ally = makePiece({ position: [2, 2], strength: 1, range: 1 });
        placePiece(board, ally);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = validateMove([2, 2], piece, game);

        expect(result).toBe("Destination square is occupied by an ally piece");
    });

    // --- Legal move ---
    it("returns null for a legal move", () => {
        const game = makeGame({ board: createGridBoard(4, 4) });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const result = validateMove([2, 2], piece, game);

        expect(result).toBeNull();
    });

    // --- Purity: validation must not mutate any state ---
    it("does not mutate the piece, board, or game state", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board });
        const piece = makePiece({ position: [1, 1], strength: 1, range: 1 });

        const before = {
            position: [...piece.position],
            strength: piece.strength,
            armor: piece.armor,
            spike: piece.spike,
            turnCount: game.turnCount,
            turn: game.turn,
            historyLength: game.gameHistory.length,
        };

        validateMove([2, 2], piece, game);

        expect(piece.position).toEqual(before.position);
        expect(piece.strength).toBe(before.strength);
        expect(piece.armor).toBe(before.armor);
        expect(piece.spike).toBe(before.spike);
        expect(game.turnCount).toBe(before.turnCount);
        expect(game.turn).toBe(before.turn);
        expect(game.gameHistory.length).toBe(before.historyLength);
        // Board squares unchanged.
        expect(board["1,1"]!.tenant).toBeNull();
        expect(board["2,2"]!.tenant).toBeNull();
    });
});