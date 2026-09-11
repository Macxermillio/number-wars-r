import { Server } from "socket.io";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import express from "express";
import crypto from "crypto";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import startGame, { type gameState } from "../assets/start.ts";
import { move, validateMove } from "../assets/pieces.ts";
import { mergeEffect, splitEffect, weakenEffect, strengthenPiece } from "../assets/effects.ts";
import { brickBoard, chooseTurnEffect, spawnShards, spawnStar, checkStarWin } from "../assets/mechanics.ts";
import { getAiMove, legalRandomMove } from "./ai/llm.ts";
import { Worker } from "worker_threads";
import { cpus } from "os";
import type { GameMode, Room, PlayerSlot } from "./protocol.ts";
import { legalMoves } from "./ai/simulation.ts";
import type { AiAction } from "./ai/simulation.ts";
import { isWellFormedAiAction } from "./ai/simulation.ts";
import { saveRoom, getRoom, deleteRoom, listRooms, touchRoom, isRedisEnabled } from "./redis.ts";

// --- Computer-opponent worker pool (ARCHITECTURE §4) ---
// Stateless workers: receive a gameState + difficulty, return a move.
const COMPUTER_WORKERS = process.env.COMPUTER_WORKERS
    ? parseInt(process.env.COMPUTER_WORKERS, 10)
    : Math.max(1, cpus().length - 1 || 1);
const computerWorkers: Worker[] = [];
const computerPending = new Map<number, (move: ComputerMove | null, error?: string) => void>();
let nextComputerMsgId = 1;
let nextWorkerIndex = 0;

export type ComputerDifficulty = "easy" | "medium" | "hard" | "insane";

export type ComputerMove = AiAction;

function initComputerWorkers() {
    if (computerWorkers.length > 0) return;
    for (let i = 0; i < COMPUTER_WORKERS; i++) {
        const w = new Worker(new URL("./ai/search-worker.ts", import.meta.url));
        w.on("message", (msg: { id: number; move: ComputerMove | null; error?: string }) => {
            const cb = computerPending.get(msg.id);
            if (!cb) return;
            computerPending.delete(msg.id);
            cb(msg.move, msg.error);
        });
        w.on("error", (err) => {
            console.error("[computer] worker error:", err.message);
        });
        w.unref();
        computerWorkers.push(w);
    }
    console.log(`[computer] worker pool ready (${computerWorkers.length} workers)`);
}

// Round-robin: hand each search to the next worker that is free (or the next one).
function requestComputerMove(state: gameState, difficulty: ComputerDifficulty, affiliation: "red" | "blue"): Promise<ComputerMove | null> {
    initComputerWorkers();
    const id = nextComputerMsgId++;
    const worker = computerWorkers[nextWorkerIndex++ % computerWorkers.length]!;
    return new Promise((resolve, reject) => {
        computerPending.set(id, (move, error) => {
            if (error) reject(new Error(error));
            else resolve(move);
        });
        worker.postMessage({ id, state, difficulty, affiliation });
    });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---
const PORT = parseInt(process.env.PORT || "3000", 10);
const DISCONNECT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (room expiry)
const OPPONENT_NOTICE_DELAY_MS = 30 * 1000; // 30s grace before telling opponent

// --- In-memory state (L1 cache; Redis is durable L2) ---
const rooms = new Map<string, Room>();
const roomTimers = new Map<string, NodeJS.Timeout>();
const disconnectNotices = new Map<string, NodeJS.Timeout>();

// Cache-aside read: memory first, Redis fallback (post-restart recovery).
async function fetchRoom(roomId: string): Promise<Room | null> {
    const cached = rooms.get(roomId);
    if (cached) {
        void touchRoom(roomId);
        return cached;
    }
    const persisted = await getRoom(roomId);
    if (persisted) {
        rooms.set(roomId, persisted);
        void touchRoom(roomId);
        return persisted;
    }
    return null;
}

function persist(room: Room): void {
    // Write-through, fire-and-forget so the hot move path stays fast.
    // Redis failures only log — the game continues memory-only.
    void saveRoom(room);
}

// --- Express app ---
const app = express();
app.use(cookieParser());
app.use(express.json());

// Serve static client files (client/ lives at the repo root, two levels up from server/)
app.use(express.static(path.join(__dirname, "..", "..", "client")));

// Catch-all for SPA routing: /play/* serves index.html
app.get("/play/:roomId", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "..", "client", "index.html"));
});

// Health check for Railway's load balancer / healthchecks
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
});

// --- HTTP server ---
const httpServer = createServer(app);

// --- Socket.IO server ---
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN || "http://localhost:3000",
        credentials: true,
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: DISCONNECT_TIMEOUT_MS,
        skipMiddlewares: true,
    },
});

// ==================== Helper functions ====================

function generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8);
}

function getPlayerId(socket: any): string {
    // Preferred: the id we assigned on create/join for this socket.
    if (socket.data?.playerId) return socket.data.playerId as string;
    // Fallback: handshake cookie (legacy clients).
    const cookies = socket.handshake.headers.cookie || "";
    const match = cookies.match(/playerId=([^;]+)/);
    if (match) return decodeURIComponent(match[1]!);
    // Fallback: auth payload (fresh tabs can send the stored id here).
    if (socket.handshake.auth?.playerId) return socket.handshake.auth.playerId as string;
    return "";
}

function isBotSlot(p: PlayerSlot): boolean {
    return p.socketId === null && (p.playerId.startsWith("ai-") || p.playerId.startsWith("computer-"));
}

function humanSlots(room: Room): PlayerSlot[] {
    return room.players.filter(p => !isBotSlot(p));
}

function cancelRoomExpiry(roomId: string) {
    const timer = roomTimers.get(roomId);
    if (timer) {
        clearTimeout(timer);
        roomTimers.delete(roomId);
    }
}

function cancelDisconnectNotice(roomId: string, playerId: string) {
    const key = `${roomId}:${playerId}`;
    const timer = disconnectNotices.get(key);
    if (timer) {
        clearTimeout(timer);
        disconnectNotices.delete(key);
    }
}

function scheduleRoomExpiryIfAllGone(room: Room) {
    // Only expire the room when every human seat is disconnected. A single
    // disconnect just triggers the 30s opponent notice; the seat is kept so
    // the same playerId can reclaim it.
    const humans = humanSlots(room);
    if (humans.length === 0) return;
    if (humans.some(h => h.connected)) {
        return;
    }
    if (roomTimers.has(room.roomId)) return;
    const timer = setTimeout(() => {
        rooms.delete(room.roomId);
        roomTimers.delete(room.roomId);
        void deleteRoom(room.roomId);
        io.to(room.roomId).emit("error", "Room expired due to inactivity");
        console.log(`[room] ${room.roomId} destroyed (timeout)`);
    }, DISCONNECT_TIMEOUT_MS);
    roomTimers.set(room.roomId, timer);
}

function scheduleOpponentNotice(room: Room, slot: PlayerSlot) {
    // Bot opponents never disconnect — no one to notify in ai/computer rooms.
    if (room.mode === "ai" || room.mode === "computer") return;
    const key = `${room.roomId}:${slot.playerId}`;
    if (disconnectNotices.has(key)) return;
    const timer = setTimeout(async () => {
        disconnectNotices.delete(key);
        // Only notify if the player is still gone (no quick reconnect).
        const current = (rooms.get(room.roomId) ?? await getRoom(room.roomId)) as Room | null;
        if (!current) return;
        const currentSlot = current.players.find(p => p.playerId === slot.playerId);
        if (!currentSlot || currentSlot.connected) return;
        const payload = { affiliation: currentSlot.affiliation, playerId: currentSlot.playerId };
        // `playerDisconnected` is the legacy event; `opponentDisconnected`
        // is the new explicit one. Emit both for backwards compatibility.
        io.to(room.roomId).emit("playerDisconnected", payload);
        io.to(room.roomId).emit("opponentDisconnected", payload);
        console.log(`[room] ${room.roomId} ${currentSlot.affiliation} still disconnected after 30s — opponent notified`);
    }, OPPONENT_NOTICE_DELAY_MS);
    disconnectNotices.set(key, timer);
}

function attachSocketToSlot(room: Room, slot: PlayerSlot, socket: any) {
    slot.socketId = socket.id;
    slot.connected = true;
    delete (slot as any).disconnectedAt;
    socket.data.playerId = slot.playerId;
    socket.join(room.roomId);
    cancelRoomExpiry(room.roomId);
    cancelDisconnectNotice(room.roomId, slot.playerId);
}

// A move can arrive during the small window between Socket.IO reconnecting
// and the client's automatic joinRoom acknowledgement. Since the playerId is
// durable, repair the socket membership at the intent boundary instead of
// rejecting a valid player with "You are not in this room".
function reattachSocketIfKnown(room: Room, playerId: string, socket: any): PlayerSlot | null {
    const slot = room.players.find(p => p.playerId === playerId);
    if (!slot || isBotSlot(slot)) return null;
    if (slot.socketId !== socket.id || !slot.connected) {
        attachSocketToSlot(room, slot, socket);
        persist(room);
    } else if (!socket.rooms.has(room.roomId)) {
        socket.join(room.roomId);
    }
    return slot;
}
//Need
// Return the AI/computer player slot, creating it on demand if missing.
// The AI is red and has no socket, so it can never conflict with a human.
function getAiPlayer(room: Room): PlayerSlot {
    let ai = room.players.find(p => p.affiliation === "red" && !p.socketId);
    if (!ai) {
        ai = {
            playerId: `ai-${room.roomId}`,
            socketId: null,
            affiliation: "red",
            connected: true,
        };
        room.players.push(ai);
    }
    return ai;
}

function setPlayerIdCookie(res: any, playerId: string) {
    // Set cookie via Set-Cookie header on the socket response
    // Socket.IO doesn't easily set cookies via middleware, so we'll do it
    // client-side or via express response
}

// Find a piece by position on the board
function findPieceByPosition(state: gameState, col: number, row: number, affiliation: string): any | null {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    return pieces.find(p => p.position[0] === col && p.position[1] === row) || null;
}

// ==================== The turn pipeline ====================

function processMoveIntent(room: Room, playerId: string, fromCol: number, fromRow: number, toCol: number, toRow: number): { error?: string; result?: string } {
    const state = room.state as gameState;
    const slot = room.players.find(p => p.playerId === playerId);
    if (!slot) return { error: "Player not in room" };

    // `move()` also validates turn ownership through game history, but the
    // authoritative source is the state turn. This must happen before any
    // piece lookup or mutation so stale async AI/computer requests cannot be
    // applied after the turn has changed.
    if (state.turn !== slot.affiliation) {
        return { error: "It's not your turn." };
    }

    const piece = findPieceByPosition(state, fromCol, fromRow, slot.affiliation);
    if (!piece) return { error: "No piece found at that position" };

    const destination: [number, number] = [toCol, toRow];

    // Check if destination has an ally piece AND current turn effect is Merge
    const targetSquare = state.board[`${toCol},${toRow}`];
    if (targetSquare?.tenant && targetSquare.tenant.affiliation === slot.affiliation) {
        if (state.turnEffect !== "Merge") {
            return { error: "Cannot land on an ally piece — only allowed on Merge turns" };
        }
        // Merge turn: call mergeEffect
        const result = mergeEffect(piece, targetSquare.tenant, state.board, state);
        if (typeof result === "string" && result !== "Pieces merged") {
            return { error: result };
        }
        // mergeEffect mutates the pieces but does not record the action or
        // advance the turn. Record it before flipping turns so the legacy
        // move validator's history remains synchronized with state.turn.
        state.gameHistory.push({
            turn: state.turnCount,
            event: `${slot.affiliation === "blue" ? "Blue" : "Red"} ${piece.strength} from ${fromCol},${fromRow} merged with ${slot.affiliation === "blue" ? "Blue" : "Red"} ${targetSquare.tenant.strength} at ${toCol},${toRow} (merged)`,
            player: slot.affiliation,
        });
        // Effects don't advance turn — do it here
        state.turnCount += 1;
        state.turn = state.turn === "blue" ? "red" : "blue";
        state.turnEffect = chooseTurnEffect();
        return { result: "merge" };
    }

    // Normal move/capture — use existing move() function
    // move() handles validation, capture, shards, turn advancement, history
    const turnCountBeforeMove = state.turnCount;
    const result = move(destination, piece, state) ?? "Unknown move error";
    if (result !== "Piece moved successfully" && result !== "Piece captured" && result !== "Piece died to spikes" && result !== "Piece repelled" && result !== "Piece bounced off armor") {
        return { error: result };
    }

    // `move()` advances the turn for an empty-square move, but the capture()
    // branches return early for combat outcomes. Those are still complete
    // moves and must consume exactly one turn as well.
    if (state.turnCount === turnCountBeforeMove) {
        state.turnCount += 1;
        state.turn = piece.affiliation === "red" ? "blue" : "red";
    }

    // move() already advanced the turn. Now roll the next turn effect.
    state.turnEffect = chooseTurnEffect();

    return { result };
}

function processEffectIntent(room: Room, playerId: string, effect: string, targetCol: number, targetRow: number): { error?: string; result?: string } {
    const state = room.state as gameState;
    const slot = room.players.find(p => p.playerId === playerId);
    if (!slot) return { error: "Player not in room" };

    // Effects consume the current turn too. Keep this authoritative check at
    // the shared intent boundary so an effect cannot be applied after a
    // delayed/stale client request.
    if (state.turn !== slot.affiliation) {
        return { error: "It's not your turn." };
    }

    // Find target piece (ally or enemy — effects are affiliation-agnostic except Split)
    const redTarget = state.redPieces.find(p => p.position[0] === targetCol && p.position[1] === targetRow);
    const blueTarget = state.bluePieces.find(p => p.position[0] === targetCol && p.position[1] === targetRow);
    const target = redTarget || blueTarget;
    if (!target) return { error: "No piece found at target position" };

    let result: string | undefined;

    switch (effect) {
        case "split": {
            // Split requires your own piece
            if (target.affiliation !== slot.affiliation) return { error: "Can only split your own piece" };
            result = splitEffect(target, state.board, state);
            break;
        }
        case "weaken": {
            result = weakenEffect(target, state);
            break;
        }
        case "strengthen": {
            result = strengthenPiece(target, state);
            break;
        }
        default:
            return { error: `Unknown effect: ${effect}` };
    }

    const effectSucceeded = result === "Piece weakened" ||
        result === "Piece strengthened" ||
        result?.startsWith("Piece created") === true;
    if (!effectSucceeded) {
        return { error: result || "Effect failed" };
    }

    // Effects don't advance the turn — do it here
    const side = slot.affiliation === "blue" ? "Blue" : "Red";
    const detail = effect === "split"
        ? `${side} ${target.strength} split at ${targetCol},${targetRow}`
        : effect === "weaken"
            ? `${side} weakened ${target.affiliation === "blue" ? "Blue" : "Red"} ${target.strength} at ${targetCol},${targetRow} (-1 str/armor/range)`
            : `${side} strengthened ${target.affiliation === "blue" ? "Blue" : "Red"} ${target.strength} at ${targetCol},${targetRow} (doubled strength, paid armor)`;
    state.gameHistory.push({
        turn: state.turnCount,
        event: `Effect used: ${effect} — ${detail}`,
        player: slot.affiliation,
    });
    state.turnCount += 1;
    state.turn = state.turn === "blue" ? "red" : "blue";
    state.turnEffect = chooseTurnEffect();

    return { result: "effect" };
}

function runPostMoveStages(state: gameState) {
    // Stage 3: bricking
    brickBoard(state);

    // Stage 4: shard spawns
    spawnShards(state);

    // Stage 4b: star spawn + alternate win check
    spawnStar(state);
    if (state.gameOver) {
        return;
    }
    const starWinner = checkStarWin(state);
    if (starWinner) {
        state.gameOver = true;
        state.gameWinner = starWinner;
        state.gameHistory.push({ turn: state.turnCount, event: `${starWinner === "blue" ? "Blue" : "Red"} collected ${state.starsToWin} stars and wins!`, player: starWinner });
    }

    // Stage 5: win check
    if (state.redPieces.length === 0) {
        state.gameOver = true;
        state.gameWinner = "blue";
        state.gameHistory.push({ turn: state.turnCount, event: "Blue wins!", player: "blue" });
    } else if (state.bluePieces.length === 0) {
        state.gameOver = true;
        state.gameWinner = "red";
        state.gameHistory.push({ turn: state.turnCount, event: "Red wins!", player: "red" });
    }

    // Stage 6: keep the FULL move history — no trimming. Entries are
    // small strings (~1 per turn), so even a 300-turn game is only tens of
    // KB. The client renders a window + full explorer; the LLM gets it all.
}

// ==================== AI move handling ====================

// Soft sanity bound only — an illegal move NEVER advances the turn. If the
// model keeps rejecting, we fall back to a guaranteed-legal move instead.
const MAX_AI_MOVE_ATTEMPTS = 20;

async function triggerAiMove(room: Room) {
    const state = room.state as gameState;

    // Delayed callbacks can outlive the turn that scheduled them. Do not
    // start an LLM request unless this is still the AI's turn, and never run
    // two AI searches for the same room at once.
    if (state.gameOver || state.turn !== "red") {
        console.warn(`[AI] skipping stale trigger: current turn is ${state.turn}`);
        return;
    }
    if (room.thinking) {
        console.warn("[AI] already thinking — skipping duplicate trigger");
        return;
    }
    room.thinking = true;

    try {
        // The AI is always the red player — get (or create) its slot.
        // The AI has no socket, so it never conflicts with a human player.
        const aiSlot = getAiPlayer(room);

        // Ask the LLM for a move; on rejection, feed the error back and try
        // again (like a human re-attempting after an illegal move). Only a
        // LEGAL move advances the turn.
        let lastError: string | undefined;
        let appliedMove = false;

        for (let attempt = 1; attempt <= MAX_AI_MOVE_ATTEMPTS; attempt++) {
            // A human move, reconnect, or another server callback may have
            // advanced the live state while the LLM request was in flight.
            // Never ask for or apply another red move after that happens.
            if (state.gameOver || state.turn !== "red") {
                console.warn(`[AI] turn changed to ${state.turn} while thinking — dropping stale AI search`);
                return;
            }

            const aiMove = await getAiMove(state, { lastError });
            if (!aiMove) {
                lastError = "No move proposed";
                console.warn(`[AI] No move proposed; attempt ${attempt}/${MAX_AI_MOVE_ATTEMPTS}`);
                continue;
            }

            if (state.gameOver || state.turn !== "red") {
                console.warn(`[AI] turn changed to ${state.turn} before applying move — dropping stale AI move`);
                return;
            }

            const result = aiMove.action === "move"
                ? processMoveIntent(room, aiSlot.playerId, aiMove.from_col, aiMove.from_row, aiMove.to_col, aiMove.to_row)
                : processEffectIntent(room, aiSlot.playerId, aiMove.action, aiMove.target_col, aiMove.target_row);

            if (result.error) {
                // Illegal move — same as a human: nothing happens, we retry.
                // No turn advance, no mutation (move()/mergeEffect are pure on failure).
                lastError = result.error;
                console.warn(`[AI] Invalid move: ${result.error}; retrying...`);
                continue;
            }

            console.log(`[d] AI move accepted; result=${result.result}; now turn=${state.turn}`);
            appliedMove = true;
            break;
        }

        if (!appliedMove) {
            // The model kept proposing illegal moves. Fall back to a move that
            // is guaranteed legal under the current rules — so the turn NEVER
            // advances on an illegal move. This only triggers after ~20 rounds.
            console.warn("[AI] LLM produced no legal move — falling back to a guaranteed-legal move");
            if (state.gameOver || state.turn !== "red") {
                console.warn(`[AI] turn changed to ${state.turn} before fallback — dropping stale AI move`);
                return;
            }
            const fallback = legalRandomMove(state);
            if (fallback) {
                const result = processMoveIntent(room, aiSlot.playerId, fallback.from_col, fallback.from_row, fallback.to_col, fallback.to_row);
                if (result.error) {
                    // Shouldn't happen (legalRandomMove is validated), but if
                    // it does we still don't advance the turn — we just stop.
                    console.error(`[AI] Fallback move ALSO rejected: ${result.error} — giving up this AI turn`);
                } else {
                    console.log(`[d] AI fallback move accepted; result=${result.result}; now turn=${state.turn}`);
                }
            } else {
                // Literally no legal move exists (all pieces pinned). Leave the
                // turn on red; the client cannot proceed either, so we stop.
                console.error("[AI] No legal move exists at all — leaving turn on red");
            }
        }

        // Run post-move stages
        runPostMoveStages(state);

        // Broadcast updated state
        io.to(room.roomId).emit("gameState", state);
        persist(room);
    } finally {
        room.thinking = false;
        persist(room);
    }
}

// ==================== Computer opponent ====================

async function triggerComputerMove(room: Room) {
    const state = room.state as gameState;

    // A delayed callback may run after the red turn has already been consumed.
    // Never mark the room as thinking, or ask a worker, for a non-red turn.
    if (state.gameOver || state.turn !== "red") {
        console.warn(`[computer] skipping trigger: current turn is ${state.turn}`);
        return;
    }

    // Atomic thinking gate: if a bot turn is already in flight (e.g. a stale
    // move intent re-triggered us while the previous bot move was awaiting its
    // worker), do NOT start a second one. Without this, two bot moves can
    // both be pending, and the second one gets rejected / flips the turn twice.
    if (room.thinking) {
        console.warn("[computer] bot already thinking — skipping duplicate trigger");
        return;
    }
    room.thinking = true;

    try {
        const computerSlot = room.players.find((p) => p.affiliation === "red" && !p.socketId);
        if (!computerSlot) {
            console.error("[computer] no red bot slot found");
            return;
        }

        const rawDifficulty: string = (room as { difficulty?: string }).difficulty || "medium";
        const difficulty: ComputerDifficulty = rawDifficulty as ComputerDifficulty;
        console.log(`[computer] ${difficulty} bot thinking... (turn ${state.turnCount})`);

        // Ask a worker to pick a move (all difficulties run in the worker —
        // even easy/medium are cheap enough that the worker stays responsive).
        let move: ComputerMove | null = null;
        try {
            move = await requestComputerMove(state, difficulty, "red");
        } catch (err: any) {
            console.error("[computer] worker error:", err.message);
        }

        if (!move) {
            // No move found (shouldn't happen unless all red pieces are pinned).
            // Fall back to the server-side guaranteed-legal move.
            console.error("[computer] no bot move — falling back to algorithmic random");
            const moves = legalMoves(state, "red");
            const fb = moves.length > 0 ? moves[Math.floor(Math.random() * moves.length)]! : null;
            if (!fb) {
                console.error("[computer] no legal move at all — leaving turn on red");
                return;
            }
            move = { type: "move", ...fb };
        }

        // The worker computed against the state as of the moment we started.
        // If another event flipped the turn while we were searching, this move
        // is stale — applying it would hand the turn back to us (double turn).
        if (state.turn !== "red") {
            console.warn(`[computer] turn moved to ${state.turn} while bot was thinking — dropping stale bot move`);
            return;
        }

        // Feed the move through the exact same turn pipeline as a human move.
        // Guard against malformed worker payloads (e.g. stale heuristic shape
        // or missing coords) — never let a bad bot move crash the process.
        if (!move) return;
        if (!isWellFormedAiAction(move)) {
            console.error(`[computer] malformed bot move: ${JSON.stringify(move)} — falling back to algorithmic random`);
            move = null;
        } else {
            const result = move.type === "move"
                ? processMoveIntent(room, computerSlot.playerId, move.from[0]!, move.from[1]!, move.to[0]!, move.to[1]!)
                : processEffectIntent(room, computerSlot.playerId, move.type, move.target[0]!, move.target[1]!);
            if (!result.error) {
                runPostMoveStages(state);
                io.to(room.roomId).emit("gameState", state);
                persist(room);
                return;
            }
            // A worker move shouldn't be illegal, but if it is, fall back.
            console.error(`[computer] bot move rejected: ${result.error} — falling back to algorithmic random`);
        }
        {
            const moves = legalMoves(state, "red");
            const fb = moves.length > 0 ? moves[Math.floor(Math.random() * moves.length)]! : null;
            if (!fb) return;
            if (state.turn !== "red") {
                console.warn(`[computer] turn moved to ${state.turn} during fallback — dropping stale bot move`);
                return;
            }
            const result2 = processMoveIntent(room, computerSlot.playerId, fb.from[0], fb.from[1], fb.to[0], fb.to[1]);
            if (result2.error) {
                console.error(`[computer] fallback ALSO rejected: ${result2.error} — leaving turn on red`);
                return;
            }
            runPostMoveStages(state);
            io.to(room.roomId).emit("gameState", state);
            persist(room);
        }
    } finally {
        // Only release the lock if we still own it — a re-triggering event may
        // have re-entered and started a fresh bot turn while we were awaiting.
        if (room.thinking) room.thinking = false;
        persist(room);
    }
}

// ==================== Socket.IO handlers =====================

io.on("connection", (socket) => {
    console.log(`[connect] ${socket.id}`);
    // Seed identity from handshake auth so move/useEffect work even if the
    // client's joinRoom re-emit is still in flight after a server restart.
    // The authoritative re-attach still happens in joinRoom (socket.join +
    // slot update); this just prevents "You are not in this room" races.
    if (!socket.data?.playerId && socket.handshake.auth?.playerId) {
        socket.data.playerId = socket.handshake.auth.playerId as string;
    }

    // --- Create Room ---
    socket.on("createRoom", async ({ mode, difficulty }: { mode: GameMode; difficulty?: ComputerDifficulty }) => {
        try {
            const roomId = generateRoomId();
            const playerId = randomUUID();
            const state = startGame();

            // Roll the first turn effect (start.ts leaves "Merge" as placeholder)
            state.turnEffect = chooseTurnEffect();

            const room: Room = {
                roomId,
                state,
                players: [
                    { playerId, socketId: socket.id, affiliation: "blue", connected: true },
                ],
                mode,
                host: playerId,
                createdAt: Date.now(),
                thinking: false,
            };

            // Computer/LLM modes: pre-seed the opponent's slot so the game
            // knows there are two seats (the AI/computer has no socket).
            if (mode === "computer") {
                room.difficulty = difficulty || "medium";
                room.players.push({
                    playerId: `computer-${roomId}`,
                    socketId: null,
                    affiliation: "red",
                    connected: true,
                });
            }
            if (mode === "ai") {
                room.players.push({
                    playerId: `ai-${roomId}`,
                    socketId: null,
                    affiliation: "red",
                    connected: true,
                });
            }

            rooms.set(roomId, room);
            persist(room);
            socket.join(roomId);

            // Set playerId cookie via socket handshake response
            socket.data.playerId = playerId;

            console.log(`[room] Created ${roomId} (${mode}${room.difficulty ? " " + room.difficulty : ""}), host=${playerId}`);

            socket.emit("roomCreated", {
                roomId,
                link: `/play/${roomId}`,
                mode,
                difficulty: room.difficulty,
                playerId,
                affiliation: "blue" as const,
            });
            socket.emit("gameState", state);
        } catch (err: any) {
            socket.emit("error", `Failed to create room: ${err.message}`);
        }
    });

    // --- Join Room ---
    // Reconnect-friendly: a client that already owns a seat (same playerId,
    // sent explicitly or remembered on this socket) always reclaims that seat
    // — even if the room otherwise looks "full". Only genuinely new players
    // are subject to the capacity check.
    socket.on("joinRoom", async ({ roomId, playerId: claimedPlayerId }: { roomId: string; playerId?: string }) => {
        try {
            const room = await fetchRoom(roomId);
            if (!room) {
                socket.emit("error", "Room not found or expired");
                return;
            }

            const claimed = claimedPlayerId || socket.data.playerId || getPlayerId(socket);

            const reattach = (slot: PlayerSlot, isNewSeat: boolean) => {
                attachSocketToSlot(room, slot, socket);
                persist(room);
                socket.emit("gameState", room.state);
                socket.emit("roomJoined", {
                    roomId: room.roomId,
                    mode: room.mode,
                    affiliation: slot.affiliation,
                    playerId: slot.playerId,
                });
                if (isNewSeat) {
                    socket.emit("opponentJoined");
                    socket.to(roomId).emit("opponentJoined");
                } else {
                    // Returning player: let the opponent know we're back.
                    io.to(roomId).emit("opponentReconnected", {
                        affiliation: slot.affiliation,
                        playerId: slot.playerId,
                    });
                    io.to(roomId).emit("opponentJoined");
                    console.log(`[room] ${slot.playerId} reconnected to ${roomId} as ${slot.affiliation}`);
                }
            };

            // If already in room (same socket rejoin), allow it.
            const existing = room.players.find(p => p.socketId === socket.id);
            if (existing) {
                socket.join(roomId);
                socket.emit("gameState", room.state);
                return;
            }

            // 1) Same playerId reclaims their own seat — always allowed.
            if (claimed) {
                const reconnecting = room.players.find(p => p.playerId === claimed);
                if (reconnecting && !isBotSlot(reconnecting)) {
                    reattach(reconnecting, false);
                    return;
                }
            }

            // 2) A disconnected human seat can be taken over by a fresh
            // client with no known id (e.g. cookies cleared): fill the empty
            // seat instead of reporting "room full".
            if (room.mode === "friend") {
                const emptySeat = humanSlots(room).find(p => !p.connected);
                if (emptySeat) {
                    reattach(emptySeat, false);
                    return;
                }
            }

            // 3) Bot rooms never accept a second human.
            if (room.mode === "computer" || room.mode === "ai") {
                socket.emit("error", "This game is already in progress — only the host can rejoin");
                return;
            }

            // 4) Brand-new player joins (friend mode, room not full).
            if (humanSlots(room).length >= 2) {
                socket.emit("error", "Room is full");
                return;
            }

            const newPlayerId = randomUUID();
            const newSlot: PlayerSlot = {
                playerId: newPlayerId,
                socketId: socket.id,
                affiliation: "red",
                connected: true,
            };
            room.players.push(newSlot);
            persist(room);
            socket.data.playerId = newPlayerId;
            socket.join(roomId);
            cancelRoomExpiry(roomId);
            socket.emit("gameState", room.state);
            socket.emit("roomJoined", { roomId: room.roomId, mode: room.mode, affiliation: "red", playerId: newPlayerId });

            // Notify host
            io.to(roomId).emit("opponentJoined");

            console.log(`[room] ${newPlayerId} joined ${roomId}`);

            // Blue moves first, so the human (blue, host) gets the first turn.
            // Automated opponents (AI/computer) are red and trigger after the
            // human's first move — no need to kick them off here.
        } catch (err: any) {
            socket.emit("error", `Failed to join room: ${err.message}`);
        }
    });

    // --- Move ---
    socket.on("move", async ({ roomId, playerId: claimedPlayerId, destination, fromPosition }: { roomId: string; playerId?: string; destination: [number, number]; fromPosition?: [number, number] }) => {
        try {
            const room = await fetchRoom(roomId);
            if (!room) {
                socket.emit("error", "Room not found");
                return;
            }

            const state = room.state as gameState;
            if (state.gameOver) {
                socket.emit("error", "Game is over");
                return;
            }

            const playerId = socket.data.playerId || getPlayerId(socket) || claimedPlayerId || "";
            const slot = reattachSocketIfKnown(room, playerId, socket);
            if (!slot) {
                socket.emit("error", "You are not in this room");
                return;
            }

            // Gate: is it this player's turn?
            if (state.turn !== slot.affiliation) {
                socket.emit("error", "Not your turn");
                return;
            }

            // Gate: is AI thinking?
            if (room.thinking) {
                socket.emit("error", "Opponent is thinking");
                return;
            }

            // Gate: automated-opponent rooms only allow the human (blue) to move.
            // The red seat belongs to the AI/computer and has no socket.
            if ((room.mode === "ai" || room.mode === "computer") && slot.affiliation !== "blue") {
                socket.emit("error", "You are playing against the computer/AI — wait for your turn");
                return;
            }

            // Find the piece — either from provided fromPosition or we find it via socket
            // The client knows which piece is selected, so it sends fromPosition
            if (!fromPosition) {
                socket.emit("error", "Missing piece position");
                return;
            }

            // Process move through pipeline
            const fromCol = fromPosition[0];
            const fromRow = fromPosition[1];
            console.log(`[d] move received from ${slot.affiliation} at ${fromCol},${fromRow} -> ${destination[0]},${destination[1]} (state.turn=${state.turn}, history last=${state.gameHistory[state.gameHistory.length-1]?.player})`);
            const result = processMoveIntent(room, playerId, fromCol, fromRow, destination[0], destination[1]);

            if (result.error) {
                console.log(`[d] move REJECTED: ${result.error}`);
                socket.emit("error", result.error);
                return;
            }

            // Run post-move stages
            runPostMoveStages(state);
            console.log(`[d] move applied by ${slot.affiliation}; now turn=${state.turn}, history last=${state.gameHistory[state.gameHistory.length-1]?.player}`);

            // Broadcast to the whole room
            io.to(roomId).emit("gameState", state);
            persist(room);

            // If playing against an automated opponent, trigger its move
            if ((room.mode === "ai" || room.mode === "computer") && !state.gameOver && state.turn === "red") {
                // Small delay so the human sees the board update before the opponent "thinks"
                setTimeout(async () => {
                    const fresh = (rooms.get(roomId) ?? await getRoom(roomId)) as Room | null;
                    if (!fresh) return;
                    if (fresh.mode === "ai") triggerAiMove(fresh);
                    else triggerComputerMove(fresh);
                }, 500);
            }
        } catch (err: any) {
            console.error("[move] Error:", err);
            socket.emit("error", `Server error: ${err.message}`);
        }
    });

    // --- Use Effect ---
    socket.on("useEffect", async ({ roomId, playerId: claimedPlayerId, effect, targetPosition }: { roomId: string; playerId?: string; effect: string; targetPosition: [number, number] }) => {
        try {
            const room = await fetchRoom(roomId);
            if (!room) {
                socket.emit("error", "Room not found");
                return;
            }

            const state = room.state as gameState;
            if (state.gameOver) {
                socket.emit("error", "Game is over");
                return;
            }

            const playerId = socket.data.playerId || getPlayerId(socket) || claimedPlayerId || "";
            const slot = reattachSocketIfKnown(room, playerId, socket);
            if (!slot) {
                socket.emit("error", "You are not in this room");
                return;
            }

            if (state.turn !== slot.affiliation) {
                socket.emit("error", "Not your turn");
                return;
            }

            if (room.thinking) {
                socket.emit("error", "Opponent is thinking");
                return;
            }

            const result = processEffectIntent(room, playerId, effect, targetPosition[0], targetPosition[1]);

            if (result.error) {
                socket.emit("error", result.error);
                return;
            }

            runPostMoveStages(state);

            io.to(roomId).emit("gameState", state);
            persist(room);

            if ((room.mode === "ai" || room.mode === "computer") && !state.gameOver && state.turn === "red") {
                setTimeout(async () => {
                    const fresh = (rooms.get(roomId) ?? await getRoom(roomId)) as Room | null;
                    if (!fresh) return;
                    if (fresh.mode === "ai") triggerAiMove(fresh);
                    else triggerComputerMove(fresh);
                }, 500);
            }
        } catch (err: any) {
            console.error("[useEffect] Error:", err);
            socket.emit("error", `Server error: ${err.message}`);
        }
    });

    // --- Rematch ---
    // Restart a finished game with the SAME players/seats. Any human in the
    // room may request it once the game is over; the board is reset and the
    // new state is broadcast to everyone in the room.
    socket.on("rematch", async ({ roomId }: { roomId: string }) => {
        try {
            const room = await fetchRoom(roomId);
            if (!room) {
                socket.emit("error", "Room not found");
                return;
            }
            const state = room.state as gameState;
            if (!state.gameOver) {
                socket.emit("error", "Game is still in progress");
                return;
            }
            const playerId = socket.data.playerId || getPlayerId(socket);
            if (!room.players.some(p => p.playerId === playerId)) {
                socket.emit("error", "You are not in this room");
                return;
            }
            const fresh = startGame();
            fresh.turnEffect = chooseTurnEffect();
            room.state = fresh as unknown as typeof room.state;
            room.thinking = false;
            cancelRoomExpiry(roomId);
            persist(room);
            console.log(`[room] ${roomId} rematch started by ${playerId}`);
            io.to(roomId).emit("gameState", room.state);
        } catch (err: any) {
            socket.emit("error", `Failed to start rematch: ${err.message}`);
        }
    });

    // --- Leave Room (quit to home) ---
    // Voluntary quit: leave the socket.io room, free the seat for expiry,
    // and notify the opponent right away (no 30s grace like a drop).
    socket.on("leaveRoom", async ({ roomId }: { roomId: string }) => {
        try {
            const room = await fetchRoom(roomId);
            if (!room) return;
            const playerId = socket.data.playerId || getPlayerId(socket);
            const slot = room.players.find(p => p.playerId === playerId);
            socket.leave(roomId);
            if (!slot || isBotSlot(slot)) return;
            slot.connected = false;
            slot.socketId = null;
            (slot as any).disconnectedAt = Date.now();
            cancelDisconnectNotice(roomId, slot.playerId);
            if (room.mode !== "ai" && room.mode !== "computer") {
                const payload = { affiliation: slot.affiliation, playerId: slot.playerId };
                socket.to(roomId).emit("playerDisconnected", payload);
                socket.to(roomId).emit("opponentDisconnected", payload);
            }
            console.log(`[room] ${playerId} quit ${roomId} (${slot.affiliation})`);
            persist(room);
            scheduleRoomExpiryIfAllGone(room);
        } catch (err: any) {
            console.error("[leaveRoom] Error:", err);
        }
    });

    // --- Disconnect ---
    // Mark the seat as disconnected but KEEP it, so the same playerId can
    // reclaim it. The opponent is only notified after a 30s grace period
    // (quick refreshes stay silent); the room itself expires after 15 min
    // only when ALL human seats are gone.
    // NOTE: after a restart, rooms live in Redis but not in the local Map —
    // scan Redis too so disconnects of recovered rooms still persist.
    socket.on("disconnect", async () => {
        console.log(`[disconnect] ${socket.id}`);

        const markGone = (room: Room) => {
            const slot = room.players.find(p => p.socketId === socket.id);
            if (!slot || isBotSlot(slot)) return false;
            slot.connected = false;
            slot.socketId = null;
            (slot as any).disconnectedAt = Date.now();
            persist(room);
            scheduleOpponentNotice(room, slot);
            scheduleRoomExpiryIfAllGone(room);
            return true;
        };

        for (const [_roomId, room] of rooms) {
            if (markGone(room)) return;
        }
        // Not in the L1 cache (e.g. fresh process after a deploy where boot
        // recovery hasn't run or the room was evicted): check Redis by the
        // playerId this socket carried.
        const pid = socket.data?.playerId || getPlayerId(socket);
        if (pid && isRedisEnabled()) {
            try {
                for (const room of await listRooms()) {
                    if (room.players.some(p => p.playerId === pid)) {
                        rooms.set(room.roomId, room);
                        markGone(room);
                        break;
                    }
                }
            } catch { /* ignore — disconnect bookkeeping is best-effort */ }
        }
    });
});

// ==================== Start server ====================

httpServer.listen(PORT, async () => {
    console.log(`[server] Number Wars running on http://localhost:${PORT}`);
    console.log(`[server] LLM_API_KEY set: ${!!process.env.LLM_API_KEY}`);
    console.log(`[server] Redis persistence: ${isRedisEnabled() ? "enabled" : "disabled (memory-only)"}`);

    // Boot recovery: reload rooms persisted before a restart/redeploy so
    // live games survive. Bot turns interrupted mid-thinking are resumed.
    if (isRedisEnabled()) {
        try {
            const persisted = await listRooms();
            for (const room of persisted) {
                rooms.set(room.roomId, room);
            }
            if (persisted.length > 0) {
                console.log(`[redis] recovered ${persisted.length} room(s) from persistence`);
                for (const room of persisted) {
                    const state = room.state as gameState;
                    if (!state.gameOver && state.turn === "red" && !room.thinking) {
                        if (room.mode === "ai") {
                            console.log(`[redis] resuming AI turn in ${room.roomId}`);
                            void triggerAiMove(room);
                        } else if (room.mode === "computer") {
                            console.log(`[redis] resuming computer turn in ${room.roomId}`);
                            void triggerComputerMove(room);
                        }
                    }
                }
            }
        } catch (err: any) {
            console.error("[redis] boot recovery failed:", err.message);
        }
    }
});

export { app, httpServer, io };