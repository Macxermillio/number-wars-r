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

function loadIndexHtml(): string {
    return readFileSync(INDEX_HTML, "utf8");
}

describe("client socket.io loading (io-is-not-defined regression)", () => {
    it("loads the Socket.IO client via a CDN <script src>, not document.write", () => {
        const html = loadIndexHtml();
        expect(html).toMatch(/<script\s+src="https:\/\/cdn\.socket\.io\/[^"]*socket\.io[^"]*"[^>]*><\/script>/);
        // No live document.write() call (mentions in comments don't count).
        expect(html).not.toMatch(/document\.write\s*\(/);
    });

    it("connectSocket() guards against `io` being undefined and returns null", () => {
        const html = loadIndexHtml();
        expect(html).toMatch(/typeof io === ['"]undefined['"]/);
        // The guard must bail out (return null) before reaching `io(`.
        const guardIdx = html.search(/typeof io === ['"]undefined['"]/);
        const ioCallIdx = html.indexOf("socket = io(", guardIdx);
        const returnNullIdx = html.indexOf("return null", guardIdx);
        expect(guardIdx).toBeGreaterThanOrEqual(0);
        expect(ioCallIdx).toBeGreaterThan(guardIdx);
        expect(returnNullIdx).toBeGreaterThan(guardIdx);
        expect(returnNullIdx).toBeLessThan(ioCallIdx);
    });

    it("createRoom() and joinByCode() handle a null socket instead of throwing", () => {
        const html = loadIndexHtml();
        // createRoom: `const s = connectSocket(null); ... if (!s) return;`
        expect(html).toMatch(/function createRoom[\s\S]*?const s = connectSocket\(null\)[\s\S]*?if \(!s\) return;/);
        // joinByCode: `const s = connectSocket(code); ... if (!s) return;`
        expect(html).toMatch(/function joinByCode[\s\S]*?const s = connectSocket\(code\)[\s\S]*?if \(!s\) return;/);
    });
});
