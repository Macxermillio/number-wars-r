import { describe, expect, it } from "vitest";
import { rehydrateRoom } from "../server/redis";
import type { Room } from "../server/protocol";
import { createGameBoard, makeGame, makePiece, placePiece } from "./helpers";

describe("persisted room rehydration", () => {
    it("restores board tenant identity from the affiliation arrays", () => {
        const board = createGameBoard();
        const red = makePiece({ affiliation: "red", position: [28, 7] });
        const blue = makePiece({ affiliation: "blue", position: [29, 7] });
        placePiece(board, red);
        placePiece(board, blue);
        const state = makeGame({ board, redPieces: [red], bluePieces: [blue] });
        const room: Room = {
            roomId: "persisted",
            state,
            players: [],
            mode: "friend",
            host: "blue",
            createdAt: Date.now(),
            thinking: false,
        };

        const parsed = JSON.parse(JSON.stringify(room)) as Room;
        const parsedState = parsed.state as typeof state;
        expect(parsedState.board["28,7"]!.tenant).not.toBe(parsedState.redPieces[0]);

        const restored = rehydrateRoom(parsed);
        const restoredState = restored.state as typeof state;
        expect(restoredState.board["28,7"]!.tenant).toBe(restoredState.redPieces[0]);
        expect(restoredState.board["29,7"]!.tenant).toBe(restoredState.bluePieces[0]);
        expect(restoredState.board["28,7"]!.occupied).toBe(true);
    });
});
