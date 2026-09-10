// division effect
import {Piece, checkBricked, maxSpikesForStrength, applySpikeCap} from "./pieces"
import { Board } from "./board"
import type { gameState } from "./start"



function createPiece(piece: Piece, game: gameState){
    const board = game.board
    const position = piece.position
    const column = position[0]
    const row = position[1]

    const north: [number, number] = [column, row - 1]
    const south: [number, number] = [column, row + 1]
    const west: [number, number]  = [column - 1, row]
    const east: [number, number]  = [column + 1, row]
    const northWest: [number, number] = [column - 1, row - 1]
    const northEast: [number, number] = [column + 1, row - 1]
    const southWest: [number, number] = [column - 1, row + 1]
    const southEast: [number, number] = [column + 1, row + 1]

    const possiblePositions: [number, number][] = [north, south, west, east, northWest, northEast, southWest, southEast]

    for (let pos of possiblePositions) {
        const key = `${pos[0]},${pos[1]}`
        // skip positions that don't exist on the board
        if (!(key in board)) {
            continue
        }
        // don't spawn on a bricked square
        if (checkBricked(pos, board)) {
            continue
        }
        // don't spawn on top of a shard or an occupied square (ally/enemy)
        if (checkOccupation(pos, board)) {
            continue
        }

        const newPiece: Piece = {
            strength: piece.strength,
            armor: piece.armor,
            spike: 0,
            range: Math.max(1, piece.range),
            position: [pos[0], pos[1]],
            affiliation: piece.affiliation,
        }
        board[key] = {
            occupied: true,
            bricked: false,
            tenant: newPiece
        }

        if (newPiece.affiliation === "blue"){
            game.bluePieces.push(newPiece)
        }

        if(newPiece.affiliation === "red"){
            game.redPieces.push(newPiece)
        }

        return "Piece created"
    }

    return "No valid position to create piece"
}

function deletePiece(board: Board, piece: Piece, game: gameState){
    const key = `${piece.position[0]},${piece.position[1]}`
    if (board[key]) {
        board[key].occupied = false
        board[key].tenant = null
    }
    if (piece.affiliation === "blue") {
        game.bluePieces = game.bluePieces.filter(p => p !== piece)
    } else if (piece.affiliation === "red") {
        game.redPieces = game.redPieces.filter(p => p !== piece)
    }
}

// addition effect: merge two ally pieces into one
export function mergeEffect(piece: Piece, target: Piece, board: Board, game: gameState){
    if (game.turn !== piece.affiliation) {
        return "Can't merge, that is not your piece"
    }
    if (piece.affiliation !== target.affiliation) {
        return "Can't merge pieces of different affiliations"
    }
    if (piece === target) {
        return "Can't merge a piece with itself"
    }

    const cx = target.position[0] - piece.position[0]
    const ry = target.position[1] - piece.position[1]
    const distance = Math.max(Math.abs(cx), Math.abs(ry))

    // target must be within range
    if (distance > piece.range) {
        return "Target is out of range"
    }

    // Pieces 5-8 move like rooks (straight lines only)
    if (piece.strength >= 5) {
        if (cx !== 0 && ry !== 0) {
            return "Piece can only move in straight lines"
        }
    }
    if (piece.strength < 5 && cx !== 0 && ry !== 0 && Math.abs(cx) !== Math.abs(ry)) {
        return "Piece must move in a straight line or diagonal"
    }
    // Pieces 1-4 move like queens (straight OR diagonal) — no direction restriction

    // check every cell between is clear (no bricked or occupied cells)
    const stepX = cx === 0 ? 0 : cx / Math.abs(cx)
    const stepY = ry === 0 ? 0 : ry / Math.abs(ry)
    for (let i = 1; i < distance; i++) {
        const key = `${piece.position[0] + stepX * i},${piece.position[1] + stepY * i}`
        const square = board[key]
        if (!square || square.bricked || square.occupied) {
            return "Path is blocked"
        }
    }

    // combine stats, capped at strength 8 and armor 10
    const newPiece: Piece = {
        strength: Math.min(piece.strength + target.strength, 8),
        armor: Math.min(piece.armor + target.armor, 10),
        spike: 0,
        range: Math.max(1, piece.range, target.range),
        position: [target.position[0], target.position[1]],
        affiliation: piece.affiliation,
    }

    // When pieces merge, the combined piece's spike count is shed to the
    // cap for its new strength (e.g. 1 + 7 -> strength 8 -> cap 2).
    const mergedSpikes = piece.spike + target.spike
    newPiece.spike = Math.min(mergedSpikes, maxSpikesForStrength(newPiece.strength))

    if (mergedSpikes > maxSpikesForStrength(newPiece.strength)) {
        game.gameHistory.push({
            turn: game.turnCount,
            event: `Spikes shed to ${newPiece.spike} after merge at ${target.position[0]},${target.position[1]}`,
            player: piece.affiliation
        })
    }

    // new piece takes the target's position
    const targetKey = `${target.position[0]},${target.position[1]}`
    board[targetKey] = {
        occupied: true,
        bricked: false,
        tenant: newPiece,
    }

    // delete the old piece
    deletePiece(board, piece, game)

    // replace the target with the merged piece in the affiliation array
    if (piece.affiliation === "blue") {
        game.bluePieces = game.bluePieces.map(p => p === target ? newPiece : p)
    } else {
        game.redPieces = game.redPieces.map(p => p === target ? newPiece : p)
    }

    return "Pieces merged"
}

export function splitEffect(piece: Piece, board: Board, game: gameState){
    if(game.turn !== piece.affiliation){
        return "Can't split piece, that is not yours"
    }

    // Splitting halves the range, but a piece must always retain at least
    // one square of movement.
    const splitRange = Math.max(1, Math.floor(piece.range / 2))

    switch(piece.strength) {
        case 2:
            piece.strength =  1
            piece.armor = Math.floor(piece.armor / 2)
            piece.range = splitRange
            piece.spike = piece.spike ? Math.floor(piece.spike / 2) : 0
            if (createPiece(piece, game) === "Piece created") return "Piece created"
            break;
        case 4:
            piece.strength =  2
            piece.armor = Math.floor(piece.armor / 2)
            piece.range = splitRange
            piece.spike = piece.spike ? Math.floor(piece.spike / 2) : 0
            if (createPiece(piece, game) === "Piece created") return "Piece created"
            break;
        case 6:
            piece.strength =  3
            piece.armor = Math.floor(piece.armor / 2)
            piece.range = splitRange
            piece.spike = piece.spike ? Math.floor(piece.spike / 2) : 0
            if (createPiece(piece, game) === "Piece created") return "Piece created"
            break;
        case 8:
            piece.strength =  4
            piece.armor = Math.floor(piece.armor / 2)
            piece.range = splitRange
            piece.spike = piece.spike ? Math.floor(piece.spike / 2) : 0
                if (createPiece(piece, game) === "Piece created") return "Piece created"
            break;

         default:
            return "Piece cannot be split"
    }
}

export function weakenEffect(piece: Piece, game: gameState){
    //this effect can work on both ally and enemy pieces
    if(piece.strength === 1 && piece.armor === 1  && piece.range === 1){
        return "Piece is invulnerable"
    }

    const reducedStrengh = piece.strength > 1 ? piece.strength - 1 : piece.strength;
    const reducedArmor = piece.armor > 1 ? piece.armor - 1 : piece.armor;
    const reducedRange = Math.max(1, piece.range - 1);

    const reducedPiece: Piece = {
        strength: reducedStrengh,
        armor: reducedArmor,
        spike: piece.spike,
        range: reducedRange,
        position: piece.position,
        affiliation: piece.affiliation
    }

    // Weakening lowers strength, which raises the spike cap by 1 —
    // spikes are kept, nothing is shed.
    applySpikeCap(reducedPiece, game)

    game.board[`${piece.position[0]},${piece.position[1]}`] = {
        occupied: true,
        bricked: false,
        tenant: reducedPiece
    }

    // Keep the affiliation array in sync — otherwise the piece's original
    // stats survive in redPieces/bluePieces and "come back" next turn.
    if (piece.affiliation === "blue") {
        game.bluePieces = game.bluePieces.map(p => p === piece ? reducedPiece : p)
    } else {
        game.redPieces = game.redPieces.map(p => p === piece ? reducedPiece : p)
    }

    return "Piece weakened"
}

export function strengthenPiece(piece: Piece, game: gameState){
    // This effect is also agnostic to ally or enemy pieces, but it will reduce armor for each strength point gained, capped at 8 strength and 0 armor

    if(piece.strength === 8){
        return "Piece cannot be strengthened further"
    }

    let strengthIncrease = Math.min(2 * piece.strength, 8);
    let strengthDifferece = strengthIncrease - piece.strength;
    let reducedArmor = Math.max(0, piece.armor - strengthDifferece);

    const strengthenedPiece: Piece = {
        strength: strengthIncrease,
        armor: reducedArmor,
        spike: piece.spike,
        range: Math.max(1, piece.range),
        position: piece.position,
        affiliation: piece.affiliation
    }

    // Strengthening raises strength, which lowers the spike cap (cap = 10 −
    // strength). Excess spikes shed to the new strength's cap — so Strengthen
    // costs armor AND any excess spikes. Example: a 3 carrying 5 spikes →
    // 6 → cap 4 → sheds to 4 spikes.
    applySpikeCap(strengthenedPiece, game)

    game.board[`${piece.position[0]},${piece.position[1]}`] = {
        occupied: true,
        bricked: false,
        tenant: strengthenedPiece
    }

    // Keep the affiliation array in sync (same bug class as weakenEffect).
    if (piece.affiliation === "blue") {
        game.bluePieces = game.bluePieces.map(p => p === piece ? strengthenedPiece : p)
    } else {
        game.redPieces = game.redPieces.map(p => p === piece ? strengthenedPiece : p)
    }

    return "Piece strengthened"
}

export function checkOccupation(destination: [number, number], board: Board): boolean {
    const targetSquare = board[`${destination[0]},${destination[1]}`]

    if (!targetSquare) {
        throw new Error(`Square at ${destination[0]},${destination[1]} does not exist on the board.`)
    }

    if (targetSquare.tenant) {
        return true
    }

    if(targetSquare.shard){
        return true
    }

    return false
}