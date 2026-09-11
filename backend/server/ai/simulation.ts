import type { Board, Square } from "../../assets/board.ts";
import type { gameState } from "../../assets/start.ts";
import type { Piece } from "../../assets/pieces.ts";
import { maxSpikesForStrength } from "../../assets/pieces.ts";

// ============================================================================
// Shared engine simulation core for the local Computer opponent.
// These helpers re-implement the server's move/capture/merge/effect rules as
// PURE functions on a cloned state, so a search can simulate any number of
// candidate moves without touching the live game.
// ============================================================================

export const minCol = 21;
export const maxCol = 36;
export const minRow = 1;
export const maxRow = 13;

export type Move = {
    from: [number, number];
    to: [number, number];
};

export type AiAction =
    | { type: "move"; from: [number, number]; to: [number, number] }
    | { type: "split" | "weaken" | "strengthen"; target: [number, number] };

// Runtime shape guard for bot/worker payloads. Malformed payloads (e.g. a
// bare {from,to} without `type`, or missing coords) must never reach the
// turn pipeline — they crashed triggerComputerMove with
// "Cannot read properties of undefined (reading '0')".
export function isWellFormedAiAction(action: unknown): action is AiAction {
    if (typeof action !== "object" || action === null) return false;
    const a = action as Record<string, unknown>;
    if (a.type === "move") {
        return Array.isArray(a.from) && Array.isArray(a.to);
    }
    if (a.type === "split" || a.type === "weaken" || a.type === "strengthen") {
        return Array.isArray(a.target);
    }
    return false;
}

const dirsOrtho: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const dirsDiag: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// The exact same value table as the ruleset.
export function pieceValue(strength: number): number {
    return strength;
}

// Total survivability of a piece: armor + strength + unused spikes.
export function effectiveHealth(p: Piece): number {
    return p.armor + p.strength + p.spike;
}

// Whether a square key is inside the board.
export function inBounds(c: number, r: number): boolean {
    return c >= minCol && c <= maxCol && r >= minRow && r <= maxRow;
}

// Manhattan distance from (c, r) to the star-spawn focus: the four hot-zone
// squares (28,6 / 29,6 / 28,8 / 29,8) plus the whole 7th row where stars
// prefer to spawn. 0 = on a focus square.
export function distToStarFocus(c: number, r: number): number {
    let d = Math.abs(r - 7); // distance to row 7 (columns always overlap 21-36)
    const hot: [number, number][] = [[28, 6], [29, 6], [28, 8], [29, 8]];
    for (const [hc, hr] of hot) {
        d = Math.min(d, Math.abs(c - hc) + Math.abs(r - hr));
    }
    return d;
}

// Generate every (from, to) move that is legal RIGHT NOW for the given
// affiliation on the given state — mirroring validateMove() + the Merge rule:
// moving onto an ally is only legal when turnEffect === "Merge".
export function legalMoves(state: gameState, affiliation: "red" | "blue"): Move[] {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    if (!Array.isArray(pieces)) return [];
    const isMergeTurn = state.turnEffect === "Merge";
    const out: Move[] = [];

    for (const p of pieces) {
        const [c, r] = p.position;
        const dirs = p.strength >= 5 ? dirsOrtho : [...dirsOrtho, ...dirsDiag];

        for (const [dc, dr] of dirs) {
            for (let d = 1; d <= p.range; d++) {
                const tc = c + dc * d;
                const tr = r + dr * d;
                if (!inBounds(tc, tr)) break;
                const sq = state.board[`${tc},${tr}`];
                if (!sq || sq.bricked) break; // blocked — can't pass through
                if (sq.tenant) {
                    if (sq.tenant.affiliation === affiliation) {
                        if (isMergeTurn) out.push({ from: p.position, to: [tc, tr] });
                        break; // ally blocks movement
                    }
                    // Enemy: capture attempt (legal).
                    out.push({ from: p.position, to: [tc, tr] });
                    break; // can't pass through
                }
                out.push({ from: p.position, to: [tc, tr] });
            }
        }
    }
    return out;
}

// Deep-clone a gameState (board + piece lists) so a search can simulate
// without mutating the real state.
export function cloneState(state: gameState): gameState {
    const board: Board = {};
    for (const [k, sq] of Object.entries(state.board)) {
        const s = sq as Square;
        board[k] = { ...s, tenant: s.tenant ? { ...s.tenant } : null };
    }
    const redPieces = state.redPieces.map((p) => ({ ...p }));
    const bluePieces = state.bluePieces.map((p) => ({ ...p }));

    // Nudge a freshly-cloned piece array so `board` tenants and `redPieces`
    // reference the same objects (the server keeps these in sync by identity).
    for (const p of redPieces) {
        board[`${p.position[0]},${p.position[1]}`]!.tenant = p;
    }
    for (const p of bluePieces) {
        board[`${p.position[0]},${p.position[1]}`]!.tenant = p;
    }

    return {
        ...state,
        board,
        redPieces,
        bluePieces,
        gameHistory: [...state.gameHistory],
    };
}

// Simulate ONE move/capture/merge on the state (which must already be a
// clone). Mirrors processMoveIntent + move() + capture() + mergeEffect.
// Returns the outcome message, or the rejection reason as { error }.
export function applyMove(state: gameState, move: Move): { error?: string; result?: string } {
    const { from, to } = move;
    const fromPiece = state.redPieces.find((p) => p.position[0] === from[0] && p.position[1] === from[1]) ||
        state.bluePieces.find((p) => p.position[0] === from[0] && p.position[1] === from[1]);
    if (!fromPiece) return { error: "No piece found at that position" };

    // Ally-occupation check (Merge turns allow landing on an ally).
    const dest = state.board[`${to[0]},${to[1]}`];
    if (dest?.tenant && dest.tenant.affiliation === fromPiece.affiliation) {
        if (state.turnEffect !== "Merge") {
            return { error: "Cannot land on an ally piece — only allowed on Merge turns" };
        }
        const target = dest.tenant;
        const mergeResult = simulateMerge(state, fromPiece, target);
        if (typeof mergeResult === "string" && mergeResult !== "Pieces merged") {
            return { error: mergeResult };
        }
        // merge doesn't persist to arrays the way the server does — inline.
        // (simulateMerge already did the work; see below)
        return { result: "merge" };
    }

    // Normal move / capture.
    const err = validateSimulatedMove(state, fromPiece, to);
    if (err) return { error: err };

    if (isEnemy(state, to, fromPiece.affiliation)) {
        const outcome = simulateCapture(state, fromPiece, to);
        return { result: outcome };
    }

    // Move to empty square (shard + star pickup).
    if (dest?.shard === "armor") fromPiece.armor += 1;
    if (dest?.shard === "spike") {
        fromPiece.spike += 1;
        const cap = maxSpikesForStrength(fromPiece.strength);
        if (fromPiece.spike > cap) fromPiece.spike = cap;
    }
    if (dest?.star) {
        delete state.board[`${to[0]},${to[1]}`]!.star;
        if (fromPiece.affiliation === "red") state.redStars += 1;
        else state.blueStars += 1;
    }
    state.board[`${from[0]},${from[1]}`]!.tenant = null;
    state.board[`${from[0]},${from[1]}`]!.occupied = false;
    state.board[`${to[0]},${to[1]}`]!.tenant = fromPiece;
    state.board[`${to[0]},${to[1]}`]!.occupied = true;
    fromPiece.position = to;
    const side = fromPiece.affiliation === "blue" ? "Blue" : "Red";
    state.gameHistory.push({ turn: state.turnCount, event: `${side} ${fromPiece.strength} moved from ${from[0]},${from[1]} to ${to[0]},${to[1]}`, player: fromPiece.affiliation });
    state.turnCount += 1;
    state.turn = state.turn === "red" ? "blue" : "red";
    return { result: "Piece moved successfully" };
}

function isEnemy(state: gameState, to: [number, number], affiliation: string): boolean {
    const tenant = state.board[`${to[0]},${to[1]}`]?.tenant;
    return !!tenant && tenant.affiliation !== affiliation;
}

function validateSimulatedMove(state: gameState, piece: Piece, to: [number, number]): string | null {
    const fromPos = piece.position;
    const cx = to[0] - fromPos[0];
    const ry = to[1] - fromPos[1];
    const distance = Math.max(Math.abs(cx), Math.abs(ry));

    // same-square
    if (cx === 0 && ry === 0) return "Piece must move to a different square";
    // Direction: all pieces move in a straight orthogonal line; pieces 1-4
    // may also move on a true diagonal. Knight-like offsets are illegal.
    if (piece.strength >= 5 && cx !== 0 && ry !== 0) return "Piece can only move in straight lines";
    if (piece.strength < 5 && cx !== 0 && ry !== 0 && Math.abs(cx) !== Math.abs(ry)) {
        return "Piece must move in a straight line or diagonal";
    }
    // range
    if (piece.range < distance) return "Piece can't move that far";
    // path clear
    const stepC = cx === 0 ? 0 : cx / Math.abs(cx);
    const stepR = ry === 0 ? 0 : ry / Math.abs(ry);
    for (let i = 1; i < distance; i++) {
        const s = state.board[`${fromPos[0] + stepC * i},${fromPos[1] + stepR * i}`];
        if (!s || s.bricked || s.occupied) return "Path is obstructed, choose another destination";
    }
    return null;
}

// Merge two ally pieces on a cloned state. Mirrors assets/effects.ts mergeEffect.
function simulateMerge(state: gameState, piece: Piece, target: Piece): string {
    const cx = target.position[0] - piece.position[0];
    const ry = target.position[1] - piece.position[1];
    const distance = Math.max(Math.abs(cx), Math.abs(ry));
    if (distance > piece.range) return "Target is out of range";
    if (piece.strength >= 5 && cx !== 0 && ry !== 0) return "Piece can only move in straight lines";
    if (piece.strength < 5 && cx !== 0 && ry !== 0 && Math.abs(cx) !== Math.abs(ry)) {
        return "Piece must move in a straight line or diagonal";
    }

    const stepX = cx === 0 ? 0 : cx / Math.abs(cx);
    const stepY = ry === 0 ? 0 : ry / Math.abs(ry);
    for (let i = 1; i < distance; i++) {
        const key = `${piece.position[0] + stepX * i},${piece.position[1] + stepY * i}`;
        const sq = state.board[key];
        if (!sq || sq.bricked || sq.occupied) return "Path is blocked";
    }

    const newPiece: Piece = {
        strength: Math.min(piece.strength + target.strength, 8),
        armor: Math.min(piece.armor + target.armor, 10),
        spike: Math.min(piece.spike + target.spike, maxSpikesForStrength(Math.min(piece.strength + target.strength, 8))),
        range: Math.max(1, piece.range, target.range),
        position: [target.position[0], target.position[1]],
        affiliation: piece.affiliation,
    };

    // remove both originals from arrays and board
    const arr = piece.affiliation === "red" ? state.redPieces : state.bluePieces;
    const filtered = arr.filter((p) => p !== piece && p !== target);
    if (piece.affiliation === "red") state.redPieces = filtered;
    else state.bluePieces = filtered;
    state.board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null;
    state.board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false;
    state.board[`${target.position[0]},${target.position[1]}`]!.tenant = newPiece;
    state.board[`${target.position[0]},${target.position[1]}`]!.occupied = true;
    (piece.affiliation === "red" ? state.redPieces : state.bluePieces).push(newPiece);

    const mside = piece.affiliation === "blue" ? "Blue" : "Red";
    state.gameHistory.push({ turn: state.turnCount, event: `${mside} ${piece.strength} merged with ${mside} ${target.strength} at ${target.position[0]},${target.position[1]} (merged)`, player: piece.affiliation });
    state.turnCount += 1;
    state.turn = state.turn === "red" ? "blue" : "red";
    return "Pieces merged";
}

// Simulate a capture on a cloned state. Mirrors assets/pieces.ts capture().
// History strings mirror the authoritative wording (with raw coords) so the
// frontend translator renders the same labels for simulated previews.
function simulateCapture(state: gameState, attacker: Piece, to: [number, number]): string {
    const target = state.board[`${to[0]},${to[1]}`]!.tenant;
    if (!target) return "No target";
    const fromLabel = `${attacker.position[0]},${attacker.position[1]}`;
    const aside = attacker.affiliation === "blue" ? "Blue" : "Red";
    const dside = target.affiliation === "blue" ? "Blue" : "Red";
    const originalArmor = attacker.armor;
    const originalStrength = attacker.strength;

    let allyArmor = attacker.armor;
    let allyStrength = attacker.strength;
    const enemyArmor = target.armor;
    const enemyStrength = target.strength;
    let enemySpike = target.spike;

    // Step 1 — spike phase.
    const spikeDamage = enemySpike;
    const spikeEffect = allyArmor - spikeDamage;
    if (spikeEffect < 0) {
        allyArmor = 0;
        allyStrength -= Math.abs(spikeEffect);
    } else {
        allyArmor -= spikeDamage;
    }
    attacker.armor = allyArmor;

    if (allyStrength <= 0) {
        // attacker dies to spikes — remove it.
        target.spike = Math.max(0, target.spike - (originalArmor + originalStrength));
        removePiece(state, attacker);
        state.gameHistory.push({ turn: state.turnCount, event: `${aside} ${originalStrength} from ${fromLabel} died to spikes attacking ${dside} ${target.strength} at ${to[0]},${to[1]} (spikes ${enemySpike} ate ${originalArmor} armor + ${originalStrength} strength)`, player: attacker.affiliation });
        return "Piece died to spikes";
    }

    // Capturing never grants strength. Spikes may reduce the attacker's
    // strength, but combat must never increase it.
    attacker.strength = Math.min(originalStrength, allyStrength);
    target.spike = Math.max(0, target.spike - spikeDamage);

    // Step 2 — capture outright?
    if (allyStrength > enemyArmor + enemyStrength + enemySpike) {
        removePiece(state, target);
        state.board[`${attacker.position[0]},${attacker.position[1]}`]!.tenant = null;
        state.board[`${attacker.position[0]},${attacker.position[1]}`]!.occupied = false;
        attacker.position = to;
        state.board[`${to[0]},${to[1]}`]!.tenant = attacker;
        state.board[`${to[0]},${to[1]}`]!.occupied = true;
        const spikeNote = spikeDamage > 0
            ? ` after spikes chipped ${Math.min(spikeDamage, originalArmor)} armor${spikeDamage > originalArmor ? ` and ${spikeDamage - originalArmor} strength` : ""}`
            : "";
        state.gameHistory.push({ turn: state.turnCount, event: `${aside} ${originalStrength} from ${fromLabel} captured ${dside} ${target.strength} at ${to[0]},${to[1]}${spikeNote}`, player: attacker.affiliation });
        return "Piece captured";
    }

    // Step 3 — armor breakthrough.
    const attackArmor = enemyArmor - allyStrength;
    if (attackArmor < 0) {
        const leftoverPower = allyStrength - enemyArmor;
        target.armor = 0;
        if (leftoverPower >= enemyStrength) {
            // captured
            removePiece(state, target);
            state.board[`${attacker.position[0]},${attacker.position[1]}`]!.tenant = null;
            state.board[`${attacker.position[0]},${attacker.position[1]}`]!.occupied = false;
            attacker.position = to;
            state.board[`${to[0]},${to[1]}`]!.tenant = attacker;
            state.board[`${to[0]},${to[1]}`]!.occupied = true;
            state.gameHistory.push({ turn: state.turnCount, event: `${aside} ${originalStrength} from ${fromLabel} captured ${dside} ${enemyStrength} at ${to[0]},${to[1]} (broke ${enemyArmor} armor, finished ${enemyStrength} strength)`, player: attacker.affiliation });
            return "Piece captured";
        }
        // repelled: defender strength reduced, attacker bounces back
        const chippedStrength = Math.min(leftoverPower, enemyStrength - 1);
        target.strength = Math.max(1, enemyStrength - leftoverPower);
        bounceBack(state, attacker, to);
        state.gameHistory.push({ turn: state.turnCount, event: `${aside} ${originalStrength} from ${fromLabel} attacked ${dside} ${enemyStrength} at ${to[0]},${to[1]}: chipped ${enemyArmor} armor and ${chippedStrength} strength, repelled to ${attacker.position[0]},${attacker.position[1]}`, player: attacker.affiliation });
        return "Piece repelled";
    }

    // armor holds — attacker bounces back
    target.armor = attackArmor;
    bounceBack(state, attacker, to);
    state.gameHistory.push({ turn: state.turnCount, event: `${aside} ${originalStrength} from ${fromLabel} attacked ${dside} ${enemyStrength} at ${to[0]},${to[1]}: chipped ${originalStrength} armor (${enemyArmor}→${attackArmor}), bounced to ${attacker.position[0]},${attacker.position[1]}`, player: attacker.affiliation });
    return "Piece bounced off armor";
}

function bounceBack(state: gameState, attacker: Piece, attackedAt: [number, number]) {
    const cx = attackedAt[0] - attacker.position[0];
    const ry = attackedAt[1] - attacker.position[1];
    const distance = Math.max(Math.abs(cx), Math.abs(ry));
    const stepCX = cx === 0 ? 0 : cx / Math.abs(cx);
    const stepRY = ry === 0 ? 0 : ry / Math.abs(ry);
    const bounce = distance >= 2 ? 2 : 1;
    const newCX = attackedAt[0] - stepCX * bounce;
    const newRY = attackedAt[1] - stepRY * bounce;

    state.board[`${attacker.position[0]},${attacker.position[1]}`]!.tenant = null;
    state.board[`${attacker.position[0]},${attacker.position[1]}`]!.occupied = false;
    attacker.position = [newCX, newRY];
    state.board[`${newCX},${newRY}`]!.tenant = attacker;
    state.board[`${newCX},${newRY}`]!.occupied = true;

    // Bounce onto a shard or star collects it (mirrors live capture()).
    const landed = state.board[`${newCX},${newRY}`];
    if (landed?.shard === "armor") attacker.armor += 1;
    if (landed?.shard === "spike") {
        attacker.spike += 1;
        const cap = maxSpikesForStrength(attacker.strength);
        if (attacker.spike > cap) attacker.spike = cap;
        delete landed.shard;
    }
    if (landed?.star) {
        delete landed.star;
        if (attacker.affiliation === "red") state.redStars += 1;
        else state.blueStars += 1;
    }
}

function removePiece(state: gameState, piece: Piece) {
    const key = `${piece.position[0]},${piece.position[1]}`;
    if (state.board[key]) {
        state.board[key].occupied = false;
        state.board[key].tenant = null;
    }
    if (piece.affiliation === "red") {
        state.redPieces = state.redPieces.filter((p) => p !== piece);
    } else {
        state.bluePieces = state.bluePieces.filter((p) => p !== piece);
    }
}

// Score a state from the perspective of `forAffiliation` (higher = better for them).
// Used both by the easy bot (pick max) and as the minimax leaf evaluator.
export function evaluateState(state: gameState, forAffiliation: "red" | "blue"): number {
    const ours = forAffiliation === "red" ? state.redPieces : state.bluePieces;
    const theirs = forAffiliation === "red" ? state.bluePieces : state.redPieces;

    // Terminal: all enemy pieces gone → huge win.
    if (theirs.length === 0) return 10000;
    if (ours.length === 0) return -10000;

    let score = 0;

    // Mobility and tactical pressure are important in the shrinking board:
    // a strong piece with no safe destinations is much less valuable.
    const ownMoves = legalMoves(state, forAffiliation).length;
    const enemyMoves = legalMoves(state, forAffiliation === "red" ? "blue" : "red").length;
    score += (ownMoves - enemyMoves) * 1.5;

    // Material: strength + armor + spikes (each valued).
    for (const p of ours) score += p.strength * 12 + p.armor * 4 + p.spike * 5 + p.range * 2;
    for (const p of theirs) score -= p.strength * 12 + p.armor * 4 + p.spike * 5 + p.range * 2;

    // Positioning: being closer to the enemy zone / center is slightly better.
    for (const p of ours) {
        // red moves "up" the board (toward row 1-3); blue moves "down".
        const targetRow = forAffiliation === "red" ? minRow : maxRow;
        score += (maxRow - Math.abs(p.position[1] - targetRow)) * 0.5;
    }
    for (const p of theirs) {
        const targetRow = forAffiliation === "red" ? maxRow : minRow;
        score -= (maxRow - Math.abs(p.position[1] - targetRow)) * 0.5;
    }

    // Stars — the alternate win condition. Collecting starsToWin wins
    // outright, so every star held is a meaningful lead (weighted heavily
    // to pull the AI toward the contested center). Urgency scales as either
    // side nears the win: a star that wins the game dwarfs all material.
    const myStars = forAffiliation === "red" ? state.redStars : state.blueStars;
    const theirStars = forAffiliation === "red" ? state.blueStars : state.redStars;
    const starsToWin = state.starsToWin || 10;

    // Terminal: star win decided.
    if (myStars >= starsToWin) return 100000;
    if (theirStars >= starsToWin) return -100000;

    const myNeeded = starsToWin - myStars;
    const theirNeeded = starsToWin - theirStars;
    // One star away from winning: each held star + denying the enemy star
    // matters enormously. Two away: still urgent. Otherwise base weight.
    const myStarWeight = myNeeded <= 1 ? 5000 : myNeeded === 2 ? 1200 : 400;
    const theirStarWeight = theirNeeded <= 1 ? 5000 : theirNeeded === 2 ? 1200 : 400;
    score += myStars * myStarWeight;
    score -= theirStars * theirStarWeight;

    // A star sitting on the board is a contested prize worth chasing.
    // Score the whole formation, not just the nearest piece: every piece
    // near the star adds pressure (contesting), and the enemy's nearest
    // piece subtracts (they contest it back). This pulls the bot toward
    // star-zone positioning even when it can't grab the star this turn.
    const starSquare = (Object.entries(state.board) as [string, Square][]).find(([, sq]) => sq.star === true);
    if (starSquare) {
        const [sc, sr] = starSquare[0].split(",").map(Number);
        for (const p of ours) {
            const d = Math.abs(p.position[0] - sc!) + Math.abs(p.position[1] - sr!);
            score += Math.max(0, 14 - d) * 6;
        }
        for (const p of theirs) {
            const d = Math.abs(p.position[0] - sc!) + Math.abs(p.position[1] - sr!);
            score -= Math.max(0, 14 - d) * 6;
        }
    } else {
        // No star on board: pre-position around the spawn focus (hot-zone
        // squares + row 7) so the bot is already contesting when the next
        // star drops. Enemy presence there subtracts symmetrically.
        for (const p of ours) {
            const d = distToStarFocus(p.position[0], p.position[1]);
            score += Math.max(0, 8 - d) * 4;
        }
        for (const p of theirs) {
            const d = distToStarFocus(p.position[0], p.position[1]);
            score -= Math.max(0, 8 - d) * 4;
        }
    }

    return score;
}

export function legalActions(state: gameState, affiliation: "red" | "blue"): AiAction[] {
    const actions: AiAction[] = legalMoves(state, affiliation).map((move) => ({ type: "move", ...move }));
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    if (state.turnEffect === "Split") {
        for (const p of pieces) if (p.strength % 2 === 0) actions.push({ type: "split", target: [...p.position] });
    } else if (state.turnEffect === "Weaken") {
        for (const p of [...state.redPieces, ...state.bluePieces]) {
            if (!(p.strength === 1 && p.armor === 1 && p.range === 1)) actions.push({ type: "weaken", target: [...p.position] });
        }
    } else if (state.turnEffect === "Strengthen") {
        for (const p of [...state.redPieces, ...state.bluePieces]) if (p.strength < 8) actions.push({ type: "strengthen", target: [...p.position] });
    }
    return actions;
}

function advanceSearchTurn(state: gameState) {
    state.turnCount += 1;
    state.turn = state.turn === "red" ? "blue" : "red";
    // Deterministic weighted approximation keeps searches reproducible while
    // still allowing future branches to use different effects.
    const roll = state.turnCount % 10;
    state.turnEffect = roll < 3 ? "Merge" : roll < 6 ? "Split" : roll < 9 ? "Weaken" : "Strengthen";
}

export function applyAction(state: gameState, action: AiAction): { error?: string; result?: string } {
    if (action.type === "move") return applyMove(state, action);
    const key = `${action.target[0]},${action.target[1]}`;
    const target = state.board[key]?.tenant;
    if (!target) return { error: "No target piece" };
    const own = target.affiliation === state.turn;
    if (action.type === "split") {
        if (!own || target.strength % 2 !== 0) return { error: "Cannot split target" };
        const adjacent: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
            .map(([dc, dr]) => [target.position[0] + dc, target.position[1] + dr]);
        const pos = adjacent.find(([c, r]) => {
            const sq = state.board[`${c},${r}`];
            return sq && !sq.bricked && !sq.occupied && sq.shard === undefined;
        });
        if (!pos) return { error: "No valid split square" };
        const half = { strength: target.strength / 2, armor: Math.floor(target.armor / 2), spike: Math.floor(target.spike / 2), range: Math.max(1, Math.floor(target.range / 2)) };
        target.strength = half.strength; target.armor = half.armor; target.spike = half.spike; target.range = half.range;
        const copy = { ...target, position: pos as [number, number] };
        state.board[`${pos[0]},${pos[1]}`]!.tenant = copy;
        state.board[`${pos[0]},${pos[1]}`]!.occupied = true;
        (target.affiliation === "red" ? state.redPieces : state.bluePieces).push(copy);
    } else if (action.type === "weaken") {
        target.strength = Math.max(1, target.strength - 1);
        target.armor = Math.max(1, target.armor - 1);
        target.range = Math.max(1, target.range - 1);
    } else {
        if (target.strength >= 8) return { error: "Cannot strengthen target" };
        const gained = Math.min(8, target.strength * 2) - target.strength;
        target.strength += gained;
        target.armor = Math.max(0, target.armor - gained);
        target.range = Math.min(8, Math.max(1, target.range * 2));
        target.spike = Math.min(target.spike, maxSpikesForStrength(target.strength));
    }
    advanceSearchTurn(state);
    return { result: action.type };
}