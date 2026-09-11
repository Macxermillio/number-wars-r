// Test helpers: small factory functions to build the game objects used in tests.
import type { Board, Square } from "../assets/board";
import type { gameState } from "../assets/start";
import type { Piece } from "../assets/pieces";

// Build a single square with sensible defaults.
export function makeSquare(overrides: Partial<Square> = {}): Square {
    return {
        occupied: false,
        bricked: false,
        tenant: null,
        ...overrides,
    };
}

// Build a piece with sensible defaults (blue, strength 1, armor 1, range 1).
export function makePiece(overrides: Partial<Piece> = {}): Piece {
    return {
        strength: 1,
        armor: 1,
        spike: 0,
        range: 1,
        position: [0, 0],
        affiliation: "blue",
        ...overrides,
    };
}

// Build a game state with sensible defaults (blue to move, empty board).
export function makeGame(overrides: Partial<gameState> = {}): gameState {
    const game: gameState = {
        board: {},
        turn: "blue",
        bricks: 0,
        turnEffect: "Merge",
        redPieces: [],
        bluePieces: [],
        turnCount: 0,
        gameOver: false,
        gameWinner: null,
        shardTurn: 5,
        shardSpawnsDone: 0,
        maxShardSpawns: 10,
        lastBrickTurn: -1,
        starTurn: 10,
        redStars: 0,
        blueStars: 0,
        starsToWin: 10,
        gameHistory: [{ turn: 0, event: "game started" }],
        ...overrides,
    };
    return game;
}

// Build a rectangular grid of empty squares, e.g. createGridBoard(4, 4)
// produces squares at (0,0)..(3,3).
export function createGridBoard(width: number, height: number): Board {
    const board: Board = {};
    for (let c = 0; c < width; c++) {
        for (let r = 0; r < height; r++) {
            board[`${c},${r}`] = makeSquare();
        }
    }
    return board;
}

// Place a piece on the board at its current position (overwrites that square).
export function placePiece(board: Board, piece: Piece): void {
    const key = `${piece.position[0]},${piece.position[1]}`;
    board[key] = {
        occupied: true,
        bricked: false,
        tenant: piece,
    };
}

export function createGameBoard(): Board {
    const board: Board = {};
    for (let c = 21; c <= 36; c++) {
        for (let r = 1; r <= 13; r++) board[`${c},${r}`] = makeSquare();
    }
    return board;
}