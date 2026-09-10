import type { Piece } from "./pieces";

export type Square = {
    occupied: boolean;
    bricked: boolean;
    shard?: "armor" | "spike";
    star?: boolean;
    tenant: Piece | null;
}

export const columns = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36]; //left -> right
export const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // top  -> bottom

export const redSide = [1,2,3];
export const blueSide = [11,12,13];
export const neutralZone = [4,5,6,7,8,9,10];

// The four "hot zone" squares plus the whole 7th row: stars prefer these
// first, and fall back to the rest of the neutral zone if all are taken.
export const starPrioritySquares = [
    "28,6", "29,6", "28,8", "29,8",
];
export const starRow = 7;


export type Board = {
    [squareKey: string]: Square;
}

export function createEmptyBoard(columns: number[], rows: number[]): Board {
    const board: Board = {};
    for (const c of columns){
        for (const r of rows){
            board[`${c},${r}`] = {
                occupied: false,
                bricked: false,
                tenant: null,
            };
        }
    }
    return board;
}

