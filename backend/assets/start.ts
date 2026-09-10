import { Board, createEmptyBoard, columns, rows, redSide, blueSide } from "./board";
import { Piece, Affiliation } from "./pieces"

export type gameState = {
    board: Board,
    turn: Affiliation,
    bricks: number,
    turnEffect: "Merge" | "Split" | "Weaken" | "Strengthen",
    redPieces: Piece[],
    bluePieces: Piece[],
    turnCount: number,
    gameOver: boolean,
    gameWinner: Affiliation | null,
    shardTurn: number,
    shardSpawnsDone: number,
    maxShardSpawns: number,
    lastBrickTurn?: number,
    starTurn: number,
    redStars: number,
    blueStars: number,
    starsToWin: number,
    gameHistory: {
        turn: number,
        event: string
        player?: Affiliation
    }[]
}

const pieces: number[] = [1,2,3,4,5,6,7,8];

function createSide(
    side: number[],
    board: Board,
    columns: number[],
    affiliation: Affiliation,
    redPieces: Piece[],
    bluePieces: Piece[]
) {

    let columnSpots = [...columns]
    for(let i = 0; i < pieces.length; i++){

        const rowNumber = side[Math.floor(Math.random() * side.length)]!;
        const columnNumber = columnSpots[Math.floor(Math.random() * columnSpots.length)]!;
        let armor = 10 - (i + 1);
        let value = i + 1;
        let piece: Piece = {
            strength: value,
            armor: armor,
            spike: 0,
            range: value,
            position:[columnNumber, rowNumber],
            affiliation: affiliation,
        }
        board[`${columnNumber},${rowNumber}`] =  {
            occupied: true,
            bricked: false,
            tenant: piece,
        }


        columnSpots.splice(columnSpots.indexOf(columnNumber),1)

        if (piece.affiliation === "blue"){
            bluePieces.push(piece)
        }

        if(piece.affiliation === "red"){
            redPieces.push(piece)
        }

    }
}
// function to render the board in the console for dev purposes
function renderBoard(board: Board) {
    // header with column numbers
    let header = "     ";
    for (const c of columns) {
        header += String(c).padStart(3, " ");
    }
    console.log(header);

    // rows top -> bottom
    for (const r of rows) {
        let line = String(r).padStart(3, " ") + " ";
        for (const c of columns) {
            const square = board[`${c},${r}`];
            let cell = "·";
            if (square?.occupied && square.tenant) {
                const t = square.tenant;
                const mark = t.affiliation === "red" ? "R" : "B";
                cell = `${mark}${t.strength}`;
            }
            line += cell.padStart(3, " ");
        }
        console.log(line);
    }
}

function createInitialGameState(board: Board, redPieces: Piece[], bluePieces: Piece[]): gameState {
    const currentGame: gameState = {
        board: board,
        turn: "blue",
        bricks: 0,
        turnEffect: "Merge",
        redPieces: redPieces,
        bluePieces: bluePieces,
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
        gameHistory:[{turn: 0, event: "game started"}]

    }

    return currentGame
}

export default function startGame(): gameState {
    const board = createEmptyBoard(columns, rows);
    const redPieces: Piece[] = [];
    const bluePieces: Piece[] = [];

    createSide(redSide, board, columns, "red", redPieces, bluePieces);
    createSide(blueSide, board, columns, "blue", redPieces, bluePieces);

    console.log("Game started. Board initialized with pieces.");
    renderBoard(board);
    const gameState = createInitialGameState(board, redPieces, bluePieces)

    console.log(gameState)

    return gameState;
}