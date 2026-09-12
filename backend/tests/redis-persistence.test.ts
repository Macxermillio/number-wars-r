import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const redisSource = readFileSync(path.resolve(here, "../server/redis.ts"), "utf8");
const mainSource = readFileSync(path.resolve(here, "../server/main.ts"), "utf8");

describe("durable move persistence contract", () => {
    it("uses one Redis transaction for the full snapshot and move event", () => {
        expect(redisSource).toContain("redis.multi().setex(roomKey(roomId), ROOM_TTL_SECONDS, serializedRoom)");
        expect(redisSource).toContain("transaction.rpush(roomEventsKey(roomId), event)");
        expect(redisSource).toContain("await transaction.exec()");
    });

    it("persists an accepted action before broadcasting the new state", () => {
        const persistence = mainSource.indexOf("await persistAction(room, \"move\", slot.affiliation)");
        const broadcast = mainSource.indexOf('io.to(roomId).emit("gameState", state)', persistence);
        expect(persistence).toBeGreaterThanOrEqual(0);
        expect(broadcast).toBeGreaterThan(persistence);
    });

    it("assigns monotonically increasing action sequence numbers", () => {
        expect(mainSource).toContain("const sequence = (room.moveSequence ?? 0) + 1;");
        expect(mainSource).toContain("room.moveSequence = sequence;");
    });
});