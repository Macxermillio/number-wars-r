// Regression tests for the turn-pipeline intent boundary (server/intents.ts):
// 1. processEffectIntent must reject an effect that doesn't match the turn's
//    assigned turnEffect (the new Invalid-effect guard).
// 2. processMoveIntent must keep rejecting moves onto an ally piece on
//    non-Merge turns (the pre-existing Merge gate, now pinned at the same
//    boundary).
import { describe, it, expect } from "vitest";
import { processMoveIntent, processEffectIntent } from "../server/intents";
import type { Room } from "../server/protocol";
import type { gameState } from "../assets/start";
import { createGridBoard, makePiece, makeGame, placePiece } from "./helpers";

function makeRoom(state: gameState): Room {
    return {
        roomId: "test-room",
        state,
        players: [
            { playerId: "blue1", socketId: "s1", affiliation: "blue", connected: true },
            { playerId: "red1", socketId: "s2", affiliation: "red", connected: true },
        ],
        mode: "friend",
        host: "blue1",
        createdAt: Date.now(),
        thinking: false,
    };
}

describe("processEffectIntent turn-effect guard", () => {
    it("rejects a mismatched effect (weaken sent on a Split turn)", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turn: "blue", turnEffect: "Split" });
        const target = makePiece({ position: [2, 2], affiliation: "red", strength: 3, armor: 3, range: 3 });
        placePiece(board, target);
        game.redPieces.push(target);
        const room = makeRoom(game);

        const before = { strength: target.strength, armor: target.armor, turn: game.turn, turnCount: game.turnCount };

        const res = processEffectIntent(room, "blue1", "weaken", 2, 2);

        expect(res.error).toBe("Invalid effect: weaken — this turn's effect is Split");
        // Turn must NOT be consumed and the target must be untouched.
        expect(game.turn).toBe(before.turn);
        expect(game.turnCount).toBe(before.turnCount);
        expect(target.strength).toBe(before.strength);
        expect(target.armor).toBe(before.armor);
    });

    it("rejects every explicit effect on a Merge turn (Merge is move-only)", () => {
        for (const effect of ["split", "weaken", "strengthen"]) {
            const board = createGridBoard(4, 4);
            const game = makeGame({ board, turn: "blue", turnEffect: "Merge" });
            const own = makePiece({ position: [1, 1], affiliation: "blue", strength: 2, armor: 4, range: 2 });
            placePiece(board, own);
            game.bluePieces.push(own);
            const room = makeRoom(game);

            const res = processEffectIntent(room, "blue1", effect, 1, 1);

            expect(res.error).toBe(`Invalid effect: ${effect} — this turn's effect is Merge`);
            expect(game.turn).toBe("blue");
            expect(game.turnCount).toBe(0);
        }
    });

    it("accepts the matching effect (weaken on a Weaken turn) and consumes the turn", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turn: "blue", turnEffect: "Weaken" });
        const target = makePiece({ position: [2, 2], affiliation: "red", strength: 3, armor: 3, range: 3 });
        placePiece(board, target);
        game.redPieces.push(target);
        const room = makeRoom(game);

        const res = processEffectIntent(room, "blue1", "weaken", 2, 2);

        expect(res.error).toBeUndefined();
        expect(res.result).toBe("effect");
        expect(game.turn).toBe("red");
        expect(game.turnCount).toBe(1);
    });

    it("accepts the matching split on a Split turn", () => {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turn: "blue", turnEffect: "Split" });
        const own = makePiece({ position: [1, 1], affiliation: "blue", strength: 2, armor: 4, range: 2 });
        placePiece(board, own);
        game.bluePieces.push(own);
        const room = makeRoom(game);

        const res = processEffectIntent(room, "blue1", "split", 1, 1);

        expect(res.error).toBeUndefined();
        expect(res.result).toBe("effect");
        expect(game.turn).toBe("red");
        expect(game.turnCount).toBe(1);
    });
});

describe("processMoveIntent Merge gate (pre-existing behavior)", () => {
    function allyPair(turnEffect: gameState["turnEffect"]) {
        const board = createGridBoard(4, 4);
        const game = makeGame({ board, turn: "blue", turnEffect });
        const mover = makePiece({ position: [1, 1], affiliation: "blue", strength: 1, armor: 1, range: 2 });
        const ally = makePiece({ position: [1, 2], affiliation: "blue", strength: 1, armor: 1, range: 1 });
        placePiece(board, mover);
        placePiece(board, ally);
        game.bluePieces.push(mover, ally);
        return { game, room: makeRoom(game) };
    }

    it("rejects moving onto an ally piece on a non-Merge turn without consuming the turn", () => {
        const { game, room } = allyPair("Split");

        const res = processMoveIntent(room, "blue1", 1, 1, 1, 2);

        expect(res.error).toBe("Cannot land on an ally piece — only allowed on Merge turns");
        expect(game.turn).toBe("blue");
        expect(game.turnCount).toBe(0);
        // No merge happened — both pieces still on the board.
        expect(game.bluePieces.length).toBe(2);
    });

    it("merges when moving onto an ally piece on a Merge turn", () => {
        const { game, room } = allyPair("Merge");

        const res = processMoveIntent(room, "blue1", 1, 1, 1, 2);

        expect(res.error).toBeUndefined();
        expect(res.result).toBe("merge");
        expect(game.turn).toBe("red");
        expect(game.turnCount).toBe(1);
    });
});
