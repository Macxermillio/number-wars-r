// Number Wars — Redis persistence layer
// Single-replica now, multi-replica ready later.
//
// - Rooms are JSON-serialized to `room:{roomId}` with a 15-min TTL (matches DISCONNECT_TIMEOUT_MS).
// - The in-memory `rooms` Map in main.ts stays as an L1 cache; every mutation
//   must call `saveRoom()` (write-through) and every read should go through
//   `fetchRoom()` (cache-aside fallback to Redis).
// - If REDIS_URL is unset (local dev without Redis), all functions become
//   no-ops and the game runs memory-only exactly as before.
// - Railway: add a Redis database to the project, then on the backend service
//   add variable REDIS_URL = ${{Redis.REDIS_URL}} (private `redis.railway.internal` URL).
// - Local: docker run -d -p 6379:6379 redis:7-alpine + REDIS_URL=redis://localhost:6379
import Redis from "ioredis";
import type { Room } from "./protocol.ts";

export const ROOM_TTL_SECONDS = 15 * 60; // 15 min — must match DISCONNECT_TIMEOUT_MS
const roomKey = (roomId: string) => `room:${roomId}`;
const lockKey = (roomId: string) => `room:${roomId}:botlock`;

let redis: Redis | null = null;

if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        // Railway private networking can take a moment on cold start
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });
    redis.on("connect", () => console.log("[redis] connecting..."));
    redis.on("ready", () => console.log("[redis] ready (persistence enabled)"));
    redis.on("error", (err: Error) => console.error("[redis] error:", err.message));
} else {
    console.warn("[redis] REDIS_URL not set — running memory-only (rooms die on restart)");
}

export function isRedisEnabled(): boolean {
    return redis !== null;
}

export function getRedis(): Redis | null {
    return redis;
}

export async function saveRoom(room: Room): Promise<void> {
    if (!redis) return;
    await saveRoomJson(room.roomId, JSON.stringify(room));
}

/** Save an already-created snapshot. The caller can serialize before queueing. */
export async function saveRoomJson(roomId: string, serializedRoom: string): Promise<void> {
    if (!redis) return;
    try {
        await redis.setex(roomKey(roomId), ROOM_TTL_SECONDS, serializedRoom);
    } catch (err: any) {
        console.error(`[redis] saveRoom ${roomId} failed:`, err.message);
    }
}

/** Refresh TTL without rewriting (cheap keep-alive on reads). */
export async function touchRoom(roomId: string): Promise<void> {
    if (!redis) return;
    try {
        await redis.expire(roomKey(roomId), ROOM_TTL_SECONDS);
    } catch { /* ignore */ }
}

export async function getRoom(roomId: string): Promise<Room | null> {
    if (!redis) return null;
    try {
        const raw = await redis.get(roomKey(roomId));
        if (!raw) return null;
        return JSON.parse(raw) as Room;
    } catch (err: any) {
        console.error(`[redis] getRoom ${roomId} failed:`, err.message);
        return null;
    }
}

export async function deleteRoom(roomId: string): Promise<void> {
    if (!redis) return;
    try {
        await redis.del(roomKey(roomId), lockKey(roomId));
    } catch (err: any) {
        console.error(`[redis] deleteRoom ${roomId} failed:`, err.message);
    }
}

/** SCAN all persisted rooms — used once on boot for recovery. */
export async function listRooms(): Promise<Room[]> {
    if (!redis) return [];
    try {
        const keys: string[] = [];
        let cursor = "0";
        do {
            const [next, batch] = await redis.scan(cursor, "MATCH", "room:*", "COUNT", 100);
            cursor = next;
            // Exclude bot-lock keys
            for (const k of batch) if (!k.endsWith(":botlock")) keys.push(k);
        } while (cursor !== "0");
        if (keys.length === 0) return [];
        const raws = await redis.mget(...keys);
        const rooms: Room[] = [];
        for (const raw of raws) {
            if (!raw) continue;
            try { rooms.push(JSON.parse(raw) as Room); } catch { /* skip corrupt */ }
        }
        return rooms;
    } catch (err: any) {
        console.error("[redis] listRooms failed:", err.message);
        return [];
    }
}

// ---- Distributed bot lock (for future multi-replica) ----
// Single replica: the in-memory `room.thinking` gate is enough and this is
// skipped. With >1 replica, two instances could both trigger the red bot —
// guard with SET NX PX before starting triggerAiMove/triggerComputerMove.
export async function acquireBotLock(roomId: string, ttlMs = 30_000): Promise<boolean> {
    if (!redis) return true; // single-process mode: in-memory gate owns it
    try {
        const res = await redis.set(lockKey(roomId), process.pid.toString(), "PX", ttlMs, "NX");
        return res === "OK";
    } catch {
        return true; // fail-open: don't block the game on Redis blip
    }
}

export async function releaseBotLock(roomId: string): Promise<void> {
    if (!redis) return;
    try { await redis.del(lockKey(roomId)); } catch { /* ignore */ }
}
