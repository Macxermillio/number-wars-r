import type { Board } from "./board";
import { gameState } from "./start";
import { collectStar } from "./mechanics";


export type Affiliation = "red" | "blue"

export type Piece = {
    strength: number;
    armor: number;
    spike: number;
    range: number;
    position: [number, number];
    affiliation: "red" | "blue";
}

// Maximum spikes a piece can hold, based on its strength.
// Strength 1 can hold 9 spikes; each +1 strength drops the cap by 1,
// so strength 8 can hold 2 spikes.
//   1 -> 9, 2 -> 8, 3 -> 7, 4 -> 6, 5 -> 5, 6 -> 4, 7 -> 3, 8 -> 2
export function maxSpikesForStrength(strength: number): number {
    return Math.max(2, 10 - strength)
}

// Human-readable helpers for history events. Backend keeps raw "col,row"
// coordinates (authoritative); the frontend translates them to a1-style
// labels for display. Keep the raw coords + keywords (captured/repelled/
// bounced/died to spikes/at/to) in every event so old clients/parsers keep
// working.
function sq(pos: [number, number]): string {
    return `${pos[0]},${pos[1]}`;
}

function who(p: Piece): string {
    return `${p.affiliation === "blue" ? "Blue" : "Red"} ${p.strength}`;
}

// Clamp a piece's spike count to its strength-based cap.
// If the piece is already at the cap, the shard is still consumed (denial)
// but the spike count does not increase. Returns a message describing what
// happened, or null if nothing changed.
export function applySpikeCap(piece: Piece, game: gameState): string | null {
    const cap = maxSpikesForStrength(piece.strength)
    if (piece.spike <= cap) {
        return null
    }

    piece.spike = cap

    game.gameHistory.push({
        turn: game.turnCount,
        event: `Max spikes collected (${cap})`,
        player: piece.affiliation
    })

    return `Max spikes collected (${cap})`
}




// Pure validation: checks whether a move is legal without mutating any state.
// Returns an error message if the move is illegal, or null if it is allowed.
export function validateMove(destination: [number, number], piece: Piece, game: gameState): string | null {
    if (!checkSquareExists(destination, game.board)) {
        return "Destination square does not exist on the board."
    }

    if (!checkValidTurn(piece, game)) {
        return "It's not your turn."
    }

    const board = game.board
    const currentPosition = piece.position
    const cx = destination[0] - currentPosition[0];
    const ry = destination[1] - currentPosition[1];
    const distance = Math.max(Math.abs(cx), Math.abs(ry))

    // can it move in that direction
        // Pieces 5-8 move like rooks (straight lines only)
        if (piece.strength >= 5) {
            if (cx !== 0 && ry !== 0) {
                return "Piece can only move in straight lines"
            }
        }
        // Pieces 1-4 may move orthogonally or on a true diagonal only.
        // This rejects knight-like offsets such as (2,1).
        if (piece.strength < 5 && cx !== 0 && ry !== 0 && Math.abs(cx) !== Math.abs(ry)) {
            return "Piece must move in a straight line or diagonal"
        }

    // can it move that far
    if (piece.range < distance) {
        return "Piece can't move that far"
    }

    // is the path clear
    const stepC = cx === 0 ? 0 : cx / Math.abs(cx)
    const stepR = ry === 0 ? 0 : ry / Math.abs(ry)

    for (let i = 1; i < distance; i++) {
        const squareData = board[`${currentPosition[0] + stepC * i},${currentPosition[1] + stepR * i}`]
        if (!squareData || squareData.bricked || squareData.occupied) {
            return "Path is obstructed, choose another destination."
        }
    }

    // is the destination available
    if (checkBricked(destination, board)) {
        return "Destination square is bricked"
    }
    // is it occupied by an ally piece
    if (checkAllyPieceOccupation(destination, board, piece)) {
        return "Destination square is occupied by an ally piece"
    }

    return null
}

export function move(destination: [number, number], piece: Piece, game: gameState) {
    const board = game.board
    const currentPosition = piece.position

    // 1. Validate — no mutation happens if the move is illegal.
    const validationError = validateMove(destination, piece, game)
    if (validationError) {
        return validationError
    }

    // 2. Mutate — the move is legal, so apply it.

    // Capture an enemy piece if the destination is occupied by one.
    if (checkEnemyPieceOccupation(destination, board, piece)) {
        return capture(destination, piece, game)
    }

    // Pick up a shard if the destination has one.
    if (checkShard(destination, board)) {
        consumeShard(destination, piece, game)
    }

    // Collect a star if the destination has one.
    collectStar(destination, piece.affiliation, game)

    // Move the piece.
    const fromLabel = sq(currentPosition);
    piece.position = destination
    board[`${currentPosition[0]},${currentPosition[1]}`]!.tenant = null
    board[`${currentPosition[0]},${currentPosition[1]}`]!.occupied = false
    board[`${destination[0]},${destination[1]}`]!.tenant = piece
    board[`${destination[0]},${destination[1]}`]!.occupied = true

    game.gameHistory.push({
        turn: game.turnCount,
        event: `${who(piece)} moved from ${fromLabel} to ${sq(destination)}`,
        player: piece.affiliation
    })

    game.turnCount += 1
    game.turn = piece.affiliation === "red" ? "blue" : "red"

    return "Piece moved successfully"
}

export function checkValidTurn(piece: Piece, game: gameState): boolean {
    const lastPlayer = game.gameHistory[game.gameHistory.length - 1]?.player

    // no moves yet → blue always moves first
    if (!lastPlayer) {
        return piece.affiliation === "blue"
    }

    // otherwise, it's the other side's turn
    if (lastPlayer === piece.affiliation) {
        return false
    }

    return true
}

export function capture(destination: [number, number], piece: Piece, game: gameState) {
    const board = game.board
    const targetPosition = board[`${destination[0]},${destination[1]}`]
    if (targetPosition?.tenant) {
        let targetPiece = targetPosition.tenant
        if (targetPiece.affiliation !== piece.affiliation) {
            // Keep the attacker's original stats — used to calculate how many spikes get consumed.
            const originalArmor = piece.armor
            const originalStrength = piece.strength

            let allyArmor = piece.armor
            let allyStrength = piece.strength
            let enemyArmor = targetPiece.armor
            let enemyStrength = targetPiece.strength
            let enemySpike = targetPiece.spike

            // Spike damage: the enemy's spikes damage the attacker, absorbed by the attacker's armor first.
            // If the armor is not enough, the remaining damage hits the attacker's strength.
            let spikeDamage = enemySpike
            let spikeEffect = allyArmor - spikeDamage
            if (spikeEffect < 0) {
                allyArmor = 0
                allyStrength -= Math.abs(spikeEffect)
            } else {
                allyArmor -= spikeDamage
            }
            piece.armor = allyArmor

            // Attacker dies to spikes.
            if (allyStrength <= 0) {
                // Consumed spikes = the dead piece's original armor + strength combined.
                targetPiece.spike = Math.max(0, targetPiece.spike - (originalArmor + originalStrength))

                // Remove the attacking piece from the board.
                const fromLabel = sq(piece.position);
                board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null
                board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false
                if (piece.affiliation === "blue") {
                    const index = game.bluePieces.indexOf(piece)
                    game.bluePieces.splice(index, 1)
                }
                if (piece.affiliation === "red") {
                    const index = game.redPieces.indexOf(piece)
                    game.redPieces.splice(index, 1)
                }

                game.gameHistory.push({
                    turn: game.turnCount,
                    event: `${who(piece)} from ${fromLabel} died to spikes attacking ${who(targetPiece)} at ${sq(destination)} (spikes ${enemySpike} ate ${originalArmor} armor + ${originalStrength} strength)`,
                    player: piece.affiliation
                })

                return "Piece died to spikes"
            }

            // Capturing never grants strength. The attacker's only possible
            // strength change during combat is damage from the defender's
            // spikes, so guard the invariant explicitly.
            piece.strength = Math.min(originalStrength, allyStrength)

            // The spikes that were used up are consumed from the target.
            targetPiece.spike = Math.max(0, targetPiece.spike - spikeDamage)

            // Can the attacker capture the enemy outright?
            let targetPieceEffectiveHealth = enemyArmor + enemyStrength + enemySpike
            if (allyStrength > targetPieceEffectiveHealth) {
                // Capture succeeds.
                const fromLabel = sq(piece.position);
                const spikeNote = spikeDamage > 0
                    ? ` after spikes chipped ${Math.min(spikeDamage, originalArmor)} armor${spikeDamage > originalArmor ? ` and ${spikeDamage - originalArmor} strength` : ""}`
                    : "";
                board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null
                board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false
                piece.position = destination
                targetPosition.occupied = true
                targetPosition.tenant = piece
                if (targetPiece.affiliation === "blue") {
                    const index = game.bluePieces.indexOf(targetPiece)
                    game.bluePieces.splice(index, 1)
                }
                if (targetPiece.affiliation === "red") {
                    const index = game.redPieces.indexOf(targetPiece)
                    game.redPieces.splice(index, 1)
                }

                game.gameHistory.push({
                    turn: game.turnCount,
                    event: `${who(piece)} from ${fromLabel} captured ${who(targetPiece)} at ${sq(destination)}${spikeNote}`,
                    player: piece.affiliation
                })

                return "Piece captured"
            }

            // Capture fails. The attacker chips away at the enemy's armor.
            let attackArmor = enemyArmor - allyStrength

            if (attackArmor < 0) {
                // The attacker broke through the enemy's armor.
                // leftoverPower = the attack power left over after punching through the armor.
                let leftoverPower = allyStrength - enemyArmor
                targetPiece.armor = 0

                if (leftoverPower >= enemyStrength) {
                    // Target piece dies — the attacker captures it.
                    const fromLabel = sq(piece.position);
                    board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null
                    board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false
                    piece.position = destination
                    targetPosition.occupied = true
                    targetPosition.tenant = piece
                    if (targetPiece.affiliation === "blue") {
                        const index = game.bluePieces.indexOf(targetPiece)
                        game.bluePieces.splice(index, 1)
                    }
                    if (targetPiece.affiliation === "red") {
                        const index = game.redPieces.indexOf(targetPiece)
                        game.redPieces.splice(index, 1)
                    }

                    game.gameHistory.push({
                        turn: game.turnCount,
                        event: `${who(piece)} from ${fromLabel} captured ${who(targetPiece)} at ${sq(destination)} (broke ${enemyArmor} armor, finished ${enemyStrength} strength)`,
                        player: piece.affiliation
                    })

                    return "Piece captured"
                } else {
                    // Target piece strength gets reduced by the leftover power, attacker bounces back.
                    const chippedArmor = enemyArmor;
                    const chippedStrength = Math.min(leftoverPower, enemyStrength - 1);
                    targetPiece.strength = Math.max(1, enemyStrength - leftoverPower)

                    // Bounce back: 2 paces back on the direction it came from; if it moved only
                    // one pace, it lands adjacent to the attacked piece on the same side.
                    const cx = destination[0] - piece.position[0]
                    const ry = destination[1] - piece.position[1]
                    const distance = Math.max(Math.abs(cx), Math.abs(ry))
                    const stepCX = cx === 0 ? 0 : cx / Math.abs(cx)
                    const stepRY = ry === 0 ? 0 : ry / Math.abs(ry)
                    const bounce = distance >= 2 ? 2 : 1
                    const newCX = destination[0] - stepCX * bounce
                    const newRY = destination[1] - stepRY * bounce

                    const fromLabel = sq(piece.position);
                    board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null
                    board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false
                    piece.position = [newCX, newRY]
                    board[`${newCX},${newRY}`]!.tenant = piece
                    board[`${newCX},${newRY}`]!.occupied = true

                    // If the piece bounces onto a shard, consume it.
                    consumeShard([newCX, newRY], piece, game)
                    collectStar([newCX, newRY], piece.affiliation, game)

                    game.gameHistory.push({
                        turn: game.turnCount,
                        event: `${who(piece)} from ${fromLabel} attacked ${who(targetPiece)} at ${sq(destination)}: chipped ${chippedArmor} armor and ${chippedStrength} strength, repelled to ${sq([newCX, newRY])}`,
                        player: piece.affiliation
                    })

                    return "Piece repelled"
                }
            } else {
                // The attacker did not break through the enemy's armor — armor is reduced, attacker bounces back.
                const chipped = allyStrength;
                targetPiece.armor = attackArmor

                const cx = destination[0] - piece.position[0]
                const ry = destination[1] - piece.position[1]
                const distance = Math.max(Math.abs(cx), Math.abs(ry))
                const stepCX = cx === 0 ? 0 : cx / Math.abs(cx)
                const stepRY = ry === 0 ? 0 : ry / Math.abs(ry)
                const bounce = distance >= 2 ? 2 : 1
                const newCX = destination[0] - stepCX * bounce
                const newRY = destination[1] - stepRY * bounce

                const fromLabel = sq(piece.position);
                board[`${piece.position[0]},${piece.position[1]}`]!.tenant = null
                board[`${piece.position[0]},${piece.position[1]}`]!.occupied = false
                piece.position = [newCX, newRY]
                board[`${newCX},${newRY}`]!.tenant = piece
                board[`${newCX},${newRY}`]!.occupied = true

                // If the piece bounces onto a shard, consume it.
                consumeShard([newCX, newRY], piece, game)
                collectStar([newCX, newRY], piece.affiliation, game)

                game.gameHistory.push({
                    turn: game.turnCount,
                    event: `${who(piece)} from ${fromLabel} attacked ${who(targetPiece)} at ${sq(destination)}: chipped ${chipped} armor (${enemyArmor}→${attackArmor}), bounced to ${sq([newCX, newRY])}`,
                    player: piece.affiliation
                })

                return "Piece bounced off armor"
            }
        }
    }
}


export function checkAllyPieceOccupation(destination: [number, number], board: Board, piece: Piece): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]

    if (!targetSquare) {
        throw new Error(`Square at ${destination[0]},${destination[1]} does not exist on the board.`)
    }

    if (targetSquare.tenant !== null && targetSquare.tenant.affiliation === piece.affiliation) {
        return true
    }

    return false
}

function checkEnemyPieceOccupation(destination: [number, number], board: Board, piece: Piece): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]

    if (!targetSquare) {
        throw new Error(`Square at ${destination[0]},${destination[1]} does not exist on the board.`)
    }

    if (targetSquare.tenant !== null && targetSquare.tenant.affiliation !== piece.affiliation) {
        return true
    }

    return false
}

export function checkBricked(destination: [number, number], board: Board): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]

    if (!targetSquare) {
        throw new Error(`Square at ${destination[0]},${destination[1]} does not exist on the board.`)
    }
    return targetSquare.bricked === true
}

export function checkShard(destination: [number, number], board: Board): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]
    if (!targetSquare) {
        throw new Error(`Square at ${destination[0]},${destination[1]} does not exist on the board.`)
    }
    if (targetSquare.shard) {
        return true
    }
    return false
}

// Consume a shard on the given square, applying its effect to the piece.
// Used both for normal moves and when a piece is repelled/bounced onto a shard.
export function consumeShard(position: [number, number], piece: Piece, game: gameState) {
    const square = game.board[`${position[0]},${position[1]}`]
    if (!square || square.shard === undefined) {
        return
    }
    if (square.shard === "armor") {
        piece.armor += 1
    }
    if (square.shard === "spike") {
        piece.spike += 1
        applySpikeCap(piece, game)
    }
    delete square.shard
}



function checkSquareExists(destination: [number, number], board: Board): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]
    return !!targetSquare
}
