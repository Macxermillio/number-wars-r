// Regression tests for the "io is not defined" landing-page bug.
//
// Root cause: index.html loaded the Socket.IO client with document.write()
// pointed at the BACKEND origin. document.write is blocked/deferred by modern
// browsers (and fails outright when the backend is unreachable), so `io` was
// undefined when connectSocket()/createRoom() ran and every Play button threw
// `Uncaught ReferenceError: io is not defined`.
//
// Fix contract (pinned here so it can't regress):
//   1. index.html must load the Socket.IO client from a CDN <script src>
//      (no document.write anywhere in the file).
//   2. connectSocket() must guard `typeof io === 'undefined'` and return
//      early (null) instead of throwing.
//   3. createRoom()/joinByCode() must handle a null socket (stay on the
//      landing screen while the lib loads) instead of dereferencing it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/ lives in backend/tests → client/index.html is ../../client/index.html
const INDEX_HTML = path.resolve(__dirname, "..", "..", "client", "index.html");
const CLIENT_DIR = path.dirname(INDEX_HTML);
const CLIENT_SCRIPT_PATHS = [
    "js/state.js",
    "js/ui.js",
    "js/render.js",
    "js/interactions.js",
    "js/socket.js",
    "js/main.js",
] as const;

function loadIndexHtml(): string {
    return readFileSync(INDEX_HTML, "utf8");
}

function loadClientSource(): string {
    return CLIENT_SCRIPT_PATHS
        .map(file => readFileSync(path.join(CLIENT_DIR, file), "utf8"))
        .join("\n");
}

describe("client socket.io loading (io-is-not-defined regression)", () => {
    it("loads the Socket.IO client via a CDN <script src>, not document.write", () => {
        const html = loadIndexHtml();
        expect(html).toMatch(/<script\s+src="https:\/\/cdn\.socket\.io\/[^"]*socket\.io[^"]*"[^>]*><\/script>/);
        // No live document.write() call (mentions in comments don't count).
        expect(html).not.toMatch(/document\.write\s*\(/);
    });

    it("connectSocket() guards against `io` being undefined and returns null", () => {
        const client = loadClientSource();
        expect(client).toMatch(/typeof io === ['"]undefined['"]/);
        // The guard must bail out (return null) before reaching `io(`.
        const guardIdx = client.search(/typeof io === ['"]undefined['"]/);
        const ioCallIdx = client.indexOf("socket = io(", guardIdx);
        const returnNullIdx = client.indexOf("return null", guardIdx);
        expect(guardIdx).toBeGreaterThanOrEqual(0);
        expect(ioCallIdx).toBeGreaterThan(guardIdx);
        expect(returnNullIdx).toBeGreaterThan(guardIdx);
        expect(returnNullIdx).toBeLessThan(ioCallIdx);
    });

    it("createRoom() and joinByCode() handle a null socket instead of throwing", () => {
        const html = loadClientSource();
        // createRoom: `const s = connectSocket(null); ... if (!s) return;`
        expect(html).toMatch(/function createRoom[\s\S]*?const s = connectSocket\(null\)[\s\S]*?if \(!s\) return;/);
        // joinByCode: `const s = connectSocket(code); ... if (!s) return;`
        expect(html).toMatch(/function joinByCode[\s\S]*?const s = connectSocket\(code\)[\s\S]*?if \(!s\) return;/);
    });
});

describe("client asset loading", () => {
    it("references the extracted stylesheet and classic scripts in order", () => {
        const html = loadIndexHtml();
        expect(html).toContain('<link rel="stylesheet" href="/css/game.css" />');

        let previousIndex = -1;
        for (const scriptPath of CLIENT_SCRIPT_PATHS) {
            const tag = `<script src="/${scriptPath}"></script>`;
            const index = html.indexOf(tag);
            expect(index).toBeGreaterThan(previousIndex);
            previousIndex = index;
        }
    });

    it("keeps only the Socket.IO fallback and Tailwind config inline", () => {
        const html = loadIndexHtml();
        expect(html.match(/<style(?:\s[^>]*)?>/g) ?? []).toHaveLength(0);
        expect(html.match(/<script>([\s\S]*?)<\/script>/g) ?? []).toHaveLength(2);
        expect(html).not.toContain("Number Wars client loaded");
    });
});

describe("client movement graphics regressions", () => {
    it("keeps a collected shard visible until the moving piece arrives", () => {
        const html = loadClientSource();
        expect(html).toMatch(/const pickedShard = previousDestination\?\.shard/);
        expect(html).toMatch(/destinationCell\.classList\.add\(`shard-\$\{pickedShard\}`\)/);
        expect(html).toMatch(/tweenTransform\(clone,[\s\S]*?finalEl\.classList\.remove\('movement-arrival-hidden'\)[\s\S]*?destinationCell\.classList\.remove\(`shard-\$\{pickedShard\}`\)/);
    });

    it("animates captures before revealing the authoritative attacker", () => {
        const html = loadClientSource();
        const captureStart = html.indexOf("if (event.includes('captured'))");
        const captureEnd = html.indexOf("// Attacker died on spikes", captureStart);
        expect(captureStart).toBeGreaterThanOrEqual(0);
        expect(captureEnd).toBeGreaterThan(captureStart);
        const capture = html.slice(captureStart, captureEnd);
        expect(capture).toMatch(/finalEl\.classList\.add\('movement-arrival-hidden'\)/);
        expect(capture).toMatch(/tweenTransform\(attackerClone/);
        expect(capture).toMatch(/defenderClone\.classList\.add\('combat-hit'\)/);
        expect(capture).toMatch(/defenderClone\.style\.zIndex = '10'[\s\S]*?attackerClone\.style\.zIndex = '11'/);
        expect(capture).toMatch(/finalEl\.classList\.remove\('movement-arrival-hidden'\)/);
        expect(html).toMatch(/const isCaptureResult = lastEvent\.includes\(' captured '\)/);
        expect(html).toMatch(/if \(isBounceResult \|\| isCaptureResult\) continue;/);
    });

    it("does not inherit hidden-arrival state in bounce and spike-death clones", () => {
        const html = loadClientSource();
        const spikeStart = html.indexOf("if (event.includes('died to spikes'))");
        const bounceStart = html.indexOf("if (!event.includes('repelled')", spikeStart);
        const bounceEnd = html.indexOf("// Keep the authoritative final piece", bounceStart);
        expect(bounceStart).toBeGreaterThanOrEqual(0);
        expect(bounceEnd).toBeGreaterThan(bounceStart);
        const spike = html.slice(spikeStart, bounceStart);
        expect(spike).toMatch(/document\.createElement\('div'\)/);
        expect(spike).not.toMatch(/cloneNode\s*\(/);
        const bounce = html.slice(bounceStart, bounceEnd);
        expect(bounce).toMatch(/const clone = document\.createElement\('div'\)/);
        expect(bounce).not.toMatch(/cloneNode\s*\(/);
    });

    it("reveals a newly spawned brick only after the move animation finishes", () => {
        const html = loadClientSource();
        expect(html).toMatch(/if \(!previous\.board\[`\$\{col\},\$\{row\}`\]\?\.bricked && next\.board\[`\$\{col\},\$\{row\}`\]\?\.bricked\)/);
        expect(html).toMatch(/cell\.classList\.add\('brick-arrival-hidden'\)/);
        expect(html).toMatch(/Promise\.all\(\[\.\.\.movementPromises, combatPromise, statPromise\]\)\.finally[\s\S]*?cell\.classList\.remove\('brick-arrival-hidden'\)/);
    });

    it("reuses a socket that is already connecting", () => {
        const html = loadClientSource();
        const connectStart = html.indexOf("function connectSocket");
        const socketCreation = html.indexOf("socket = io(", connectStart);
        const reuse = html.indexOf("if (socket) {", connectStart);
        expect(reuse).toBeGreaterThan(connectStart);
        expect(reuse).toBeLessThan(socketCreation);
        expect(html.slice(reuse, socketCreation)).toMatch(/return socket/);
    });

    it("locks input while an intent or animation is pending", () => {
        const html = loadClientSource();
        expect(html).toMatch(/grid\.style\.pointerEvents = \(pendingIntent \|\| pendingAnimations > 0\) \? 'none' : ''/);
        expect(html).toMatch(/function handlePieceClick[\s\S]*?pendingIntent \|\| pendingAnimations > 0/);
        expect(html).toMatch(/function handleDestinationClick[\s\S]*?setIntentPending\(true\)[\s\S]*?socket\.emit\('move'/);
        expect(html).toMatch(/socket\.on\('error'[\s\S]*?setIntentPending\(false\)/);
        expect(html).toMatch(/socket\.on\('disconnect'[\s\S]*?setIntentPending\(false\)/);
        expect(html).toMatch(/Promise\.resolve\(done\)\.catch[\s\S]*?resolve\(\)/);
    });

    it("validates moves, merges, and effects before emitting them", () => {
        const html = loadClientSource();
        expect(html).toMatch(/function canUseEffectOn\(effect, piece\)/);
        expect(html).toMatch(/canMergeInto\(selection\.piece, \[col, row\]\)/);
        expect(html).toMatch(/canCaptureOnto\(selection\.piece, \[col, row\]\)/);
        expect(html).toMatch(/canSelectMoveTo\(selection\.piece, \[col, row\]\)/);
        expect(html).toMatch(/!square\.shard && !square\.star/);
    });

    it("does not put the client-controlled playerId in gameplay commands", () => {
        const html = loadClientSource();
        const commands = [...html.matchAll(/socket\.emit\('(move|useEffect)',\s*\{([\s\S]*?)\}\);/g)];
        expect(commands.length).toBeGreaterThan(0);
        for (const command of commands) {
            expect(command[2]).not.toMatch(/\bplayerId\s*:/);
        }
    });
});
