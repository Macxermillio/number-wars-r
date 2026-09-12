// Shared turn-pipeline intent handlers (extracted from server/main.ts).
// Kept side-effect free so unit tests can import them without booting the
// HTTP/Socket.IO server (main.ts calls httpServer.listen on import).
import { move } from "../assets/pieces.ts";
import { mergeEffect, splitEffect, weakenEffect, strengthenPiece } from "../assets/effects.ts";
import { chooseTurnEffect } from "../assets/mechanics.ts";
import type { gameState } from "../assets/start.ts";
import type { Room } from "./protocol.ts";

// Find a piece by position on the board
function findPieceByPosition(state: gameState, col: number, row: number, affiliation: string): any | null {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    return pieces.find(p => p.position[0] === col && p.position[1] === row) || null;
}

export function processMoveIntent(room: Room, playerId: string, fromCol: number, fromRow: number, toCol: number, toRow: number): { error?: string; result?: string } {
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

export function processEffectIntent(room: Room, playerId: string, effect: string, targetCol: number, targetRow: number): { error?: string; result?: string } {
    const state = room.state as gameState;
    const slot = room.players.find(p => p.playerId === playerId);
    if (!slot) return { error: "Player not in room" };

    // Effects consume the current turn too. Keep this authoritative check at
    // the shared intent boundary so an effect cannot be applied after a
    // delayed/stale client request.
    if (state.turn !== slot.affiliation) {
        return { error: "It's not your turn." };
    }

    // The turn's assigned effect is the ONLY effect that may be used this
    // turn. Merge is implicit (triggered by moving onto an ally) and can
    // never be requested explicitly — so on a Merge turn no effect is valid.
    const effectForTurn: Record<gameState["turnEffect"], string | null> = {
        Merge: null,
        Split: "split",
        Weaken: "weaken",
        Strengthen: "strengthen",
    };
    if (effectForTurn[state.turnEffect] !== effect) {
        return { error: `Invalid effect: ${effect} — this turn's effect is ${state.turnEffect}` };
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
