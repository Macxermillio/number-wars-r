// Regression tests for the PvP invite-link join flow.
//
// Bug: when a guest opened a shared room link they stayed on the homepage and
// received "Opponent connected" instead of joining as red. Root causes:
//   • joinRoom broadcast opponentJoined to the whole room (including guest)
//   • roomJoined did not hide the landing page when Socket.IO loaded slowly
//
// These tests exercise the real joinRoom socket handler (server) and pin the
// client-side handler contract (index.html).
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { io as ClientIO, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { httpServer } from "../server/main.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.resolve(__dirname, "..", "..", "client", "index.html");
const CLIENT_SCRIPT_PATHS = [
    "js/state.js",
    "js/ui.js",
    "js/render.js",
    "js/interactions.js",
    "js/socket.js",
    "js/main.js",
] as const;

function loadClientSource(): string {
    const clientDir = path.dirname(INDEX_HTML);
    return CLIENT_SCRIPT_PATHS
        .map(file => readFileSync(path.join(clientDir, file), "utf8"))
        .join("\n");
}

function waitForConnect(client: Socket): Promise<void> {
    if (client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("socket connect timeout")), 5000);
        client.once("connect", () => {
            clearTimeout(timer);
            resolve();
        });
        client.once("connect_error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function waitForEvent<T>(client: Socket, event: string, timeoutMs = 5000): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
        client.once(event, (payload: T) => {
            clearTimeout(timer);
            resolve(payload);
        });
    });
}

function trackEvent(client: Socket, event: string) {
    let count = 0;
    const handler = () => { count += 1; };
    client.on(event, handler);
    return {
        getCount: () => count,
        stop: () => client.off(event, handler),
    };
}

function connectClient(port: number, options: { auth?: { playerId: string } } = {}): Socket {
    return ClientIO(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
        ...options,
    });
}

describe("joinRoom invite-link regressions (server)", () => {
    let port = 0;
    const clients: Socket[] = [];

    beforeAll(async () => {
        await new Promise<void>((resolve, reject) => {
            httpServer.listen(0, (err?: Error) => (err ? reject(err) : resolve()));
        });
        port = (httpServer.address() as AddressInfo).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            httpServer.close((err) => (err ? reject(err) : resolve()));
        });
    });

    afterEach(() => {
        while (clients.length) clients.pop()?.disconnect();
    });

    it("assigns red to a new guest and emits opponentJoined only to the host", async () => {
        const host = connectClient(port);
        clients.push(host);
        await waitForConnect(host);

        host.emit("createRoom", { mode: "friend" });
        const created = await waitForEvent<{ roomId: string; affiliation: string }>(host, "roomCreated");
        expect(created.affiliation).toBe("blue");

        const guest = connectClient(port);
        clients.push(guest);
        await waitForConnect(guest);

        const guestOpponentJoined = trackEvent(guest, "opponentJoined");
        const hostOpponentJoined = trackEvent(host, "opponentJoined");

        guest.emit("joinRoom", { roomId: created.roomId });
        const joined = await waitForEvent<{ affiliation: string; mode: string }>(guest, "roomJoined");

        expect(joined.mode).toBe("friend");
        expect(joined.affiliation).toBe("red");
        await new Promise((r) => setTimeout(r, 150));

        expect(guestOpponentJoined.getCount()).toBe(0);
        expect(hostOpponentJoined.getCount()).toBe(1);

        guestOpponentJoined.stop();
        hostOpponentJoined.stop();
    });

    it("does not let an unjoined socket act as a player by claiming its playerId", async () => {
        const host = connectClient(port);
        clients.push(host);
        await waitForConnect(host);

        host.emit("createRoom", { mode: "friend" });
        const created = await waitForEvent<{ roomId: string; playerId: string }>(host, "roomCreated");

        const attacker = connectClient(port);
        clients.push(attacker);
        await waitForConnect(attacker);

        attacker.emit("move", {
            roomId: created.roomId,
            playerId: created.playerId,
            fromPosition: [999, 999],
            destination: [999, 998],
        });

        const error = await waitForEvent<string>(attacker, "error");
        expect(error).toBe("You are not in this room");
    });

    it("reconnecting guest gets roomJoined but not opponentJoined", async () => {
        const host = connectClient(port);
        clients.push(host);
        await waitForConnect(host);

        host.emit("createRoom", { mode: "friend" });
        const created = await waitForEvent<{ roomId: string }>(host, "roomCreated");

        const guest = connectClient(port);
        clients.push(guest);
        await waitForConnect(guest);
        guest.emit("joinRoom", { roomId: created.roomId });
        const firstJoin = await waitForEvent<{ playerId: string; affiliation: string }>(guest, "roomJoined");
        expect(firstJoin.affiliation).toBe("red");

        guest.disconnect();

        const rejoin = connectClient(port, {
            auth: { playerId: firstJoin.playerId },
        });
        clients.push(rejoin);
        await waitForConnect(rejoin);

        const guestOpponentJoined = trackEvent(rejoin, "opponentJoined");
        const hostOpponentReconnected = trackEvent(host, "opponentReconnected");
        const reconnectedPayload = waitForEvent<{ affiliation: string; playerId?: string }>(host, "opponentReconnected");

        rejoin.emit("joinRoom", { roomId: created.roomId, playerId: firstJoin.playerId });
        const rejoined = await waitForEvent<{ affiliation: string }>(rejoin, "roomJoined");
        expect(rejoined.affiliation).toBe("red");

        expect(await reconnectedPayload).toEqual({ affiliation: "red" });
        await new Promise((r) => setTimeout(r, 150));

        expect(guestOpponentJoined.getCount()).toBe(0);
        expect(hostOpponentReconnected.getCount()).toBe(1);

        guestOpponentJoined.stop();
        hostOpponentReconnected.stop();
    });
});

describe("joinRoom invite-link regressions (client handlers)", () => {
    it("roomJoined and roomCreated hide the landing page when join succeeds", () => {
        const html = loadClientSource();
        expect(html).toMatch(/socket\.on\('roomJoined',[\s\S]*?showLanding\(false\)/);
        expect(html).toMatch(/socket\.on\('roomCreated',[\s\S]*?showLanding\(false\)/);
    });

    it("opponentJoined handler ignores the red-side joiner", () => {
        const html = loadClientSource();
        const start = html.indexOf("socket.on('opponentJoined'");
        expect(start).toBeGreaterThanOrEqual(0);
        const end = html.indexOf("});", start);
        expect(end).toBeGreaterThan(start);
        const handler = html.slice(start, end);
        expect(handler).toMatch(/if \(myAffiliation === ['"]red['"]\) return;/);
    });
});
