// One-shot smoke test: AI room flow.
// 1. Create an AI room as blue host
// 2. Human (blue) makes a legal move
// 3. Expect AI (red) to reply and pass the turn back to blue — WITHOUT the server crashing
import { io } from "socket.io-client";

const URL = "http://localhost:3010";
const socket = io(URL, { transports: ["websocket"] });

const COLUMNS = [21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36];
const ROWS = [1,2,3,4,5,6,7,8,9,10,11,12,13];

function findLegalMove(state, affiliation) {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    for (const p of pieces) {
        const [c, r] = p.position;
        const dirs = p.strength >= 5
            ? [[0,-1],[0,1],[-1,0],[1,0]]
            : [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
        for (const [dc, dr] of dirs) {
            for (let d = 1; d <= p.range; d++) {
                const tc = c + dc * d;
                const tr = r + dr * d;
                if (tc < 21 || tc > 36 || tr < 1 || tr > 13) break;
                const key = `${tc},${tr}`;
                const sq = state.board[key];
                if (!sq || sq.bricked) break; // blocked
                if (sq.tenant && sq.tenant.affiliation === affiliation) break; // ally blocks
                if (sq.tenant && sq.tenant.affiliation !== affiliation) {
                    // capture attempt is allowed, pick it
                    return { from: p.position, to: [tc, tr] };
                }
                // empty square
                if (Math.random() < 0.5) return { from: p.position, to: [tc, tr] };
            }
        }
    }
    return null;
}

let created = null;
let movesMade = 0;
let awaitingAi = false;
let gameOver2 = false;
const MAX_MOVES = 6;

socket.on("connect", () => {
    console.log("[test] connected");
    socket.emit("createRoom", { mode: "ai" });
});

socket.on("roomCreated", (data) => {
    created = data.roomId;
    console.log("[test] room created (ai mode):", created);
});

socket.on("gameState", (state) => {
    if (!state || state.gameOver) {
        stateSeenGameOver = true;
        console.log("[test] final state. gameOver:", state.gameOver, "winner:", state.gameWinner);
        if (movesMade >= MAX_MOVES) {
            console.log(`[test] completed ${MAX_MOVES} rounds. SUCCESS — no crash`);
            process.exit(0);
        }
        return;
    }
    // When the AI (red) finishes its move, the turn comes back to blue.
    if (state.turn === "blue") {
        awaitingAi = false;
        if (movesMade >= MAX_MOVES) {
            console.log(`[test] made ${MAX_MOVES} human moves, AI replied each time. SUCCESS — no crash`);
            process.exit(0);
            return;
        }
        const mv = findLegalMove(state, "blue");
        if (!mv) {
            console.log("[test] no legal blue move found");
            process.exit(1);
            return;
        }
        movesMade += 1;
        awaitingAi = true;
        console.log(`[test] blue move #${movesMade}:`, mv.from, "->", mv.to);
        socket.emit("move", { roomId: created, destination: mv.to, fromPosition: mv.from });
    } else {
        awaitingAi = true;
    }
});

socket.on("error", (msg) => {
    console.log("[test] server error:", msg);
});

socket.on("disconnect", (reason) => {
    console.log("[test] socket disconnected:", reason);
    if (!stateSeenGameOver) process.exit(2);
});

let stateSeenGameOver = false;

// Safety timeout
setTimeout(() => {
    console.log("[test] TIMEOUT - something hung");
    process.exit(3);
}, 20000);