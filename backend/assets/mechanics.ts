import { gameState } from "./start";
import { neutralZone, starPrioritySquares, starRow } from "./board";







const BRICK_START_TURN = 20;   // bricking begins after turn 20 (turns 1-19 are brick-free)
const MAX_BRICKS = 40;         // stop bricking once 80 squares are bricked

// Bricks start appearing at turn 20 and stop once 80 squares are bricked.
// Safe to call every turn — it no-ops until the start turn and past the cap.
// Returns a message describing what happened, or null if nothing changed.
export function brickBoard(game: gameState): string | null {
    // no bricking before turn 20
    if (game.turnCount < BRICK_START_TURN) {
        return null
    }

    // Bricking is a once-per-turn stage. This guard also protects against a
    // duplicate post-move callback applying the stage twice to one turn.
    if (game.lastBrickTurn === game.turnCount) {
        return null
    }

    // stop bricking once the cap is reached
    const brickedCount = Object.values(game.board).filter(s => s.bricked).length
    if (brickedCount >= MAX_BRICKS) {
        return null
    }

    const board = game.board

    const boardArray = Object.entries(board)

    // A brick may only replace a genuinely empty square. Check both flags and
    // the tenant reference because imported/legacy states can have these out
    // of sync. Stars also block bricking — a star square is never free.
    const unbricked = boardArray.filter(([, square]) =>
        !square.bricked && !square.occupied && square.tenant === null && square.shard === undefined && square.star !== true
    )

    if (unbricked.length === 0) {
        return null
    }

    const randomIndex = Math.floor(Math.random() * unbricked.length)
    const squareKey = unbricked[randomIndex]![0]

    board[squareKey]!.bricked = true
    game.bricks = brickedCount + 1
    game.lastBrickTurn = game.turnCount

    return "Square bricked"
}

// Define the turn effects and their relative weights.
const effectWeights: Record<string, number> = {
    "Merge": 30,
    "Split": 30,
    "Weaken": 30,
    "Strengthen": 10 // The rare effect (multiplication)
};

function pickWeightedRandom(weights: Record<string, number>): string {
    // 1. Calculate the total weight (30 + 30 + 30 + 10 = 100)
    let totalWeight = 0;
    for (const key in weights) {
        totalWeight += weights[key]!;
    }

    // 2. Pick a random number between 0 and totalWeight
    let randomNum = Math.random() * totalWeight;

    // 3. Iterate through the items, subtracting weights until we hit 0 or below
    for (const [item, weight] of Object.entries(weights)) {
        if (randomNum < weight) {
            return item;
        }
        randomNum -= weight;
    }

    // Fallback (TypeScript expects a guaranteed return string)
    return Object.keys(weights)[0]!;
}

export function chooseTurnEffect(): gameState["turnEffect"] {
    return pickWeightedRandom(effectWeights) as gameState["turnEffect"];
}

// ---- shard spawn system ----

const SHARD_SPAWN_INTERVAL = 5;   // spawn every 5 turns, which alternates blue/red
const MAX_SHARDS_ON_BOARD = 10;   // skip a spawn if this many shards are already out
const SHARDS_PER_SPAWN = 5;        // always 3:2 (3 of one type, 2 of the other)

type ShardType = "armor" | "spike";

// Fisher-Yates shuffle, returns a new array
function shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
}

// One spawn attempt: places 5 shards (3:2) on squares that have nothing on them.
function attemptShardSpawn(game: gameState): string {
    // stop spawning after the configured total number of spawns
    if (game.shardSpawnsDone >= game.maxShardSpawns) {
        return "Max shard spawns reached";
    }

    // skip if the board already has too many shards
    const shardCount = Object.values(game.board).filter(s => s.shard !== undefined).length;
    if (shardCount >= MAX_SHARDS_ON_BOARD) {
        return "Too many shards on board, spawn skipped";
    }

    const board = game.board;

    // squares with nothing on them: no piece, not bricked, no shard already,
    // no star already, and only within the neutral zone (rows 4-10)
    const emptySquares = Object.entries(board).filter(
        ([key, square]) =>
            !square.occupied &&
            square.tenant === null &&
            !square.bricked &&
            square.shard === undefined &&
            square.star !== true &&
            neutralZone.includes(Number(key.split(",")[1]))
    );
    if (emptySquares.length === 0) {
        return "No empty squares to place shards";
    }

    // always a 3:2 split — randomly choose which type gets the 3
    const majority: ShardType = Math.random() < 0.5 ? "armor" : "spike";
    const minority: ShardType = majority === "armor" ? "spike" : "armor";

    const shardTypes: ShardType[] = [
        majority, majority, majority,
        minority, minority,
    ];

    // pick up to 5 random empty squares and place the shards on them
    const candidates = shuffle(emptySquares).slice(0, Math.min(SHARDS_PER_SPAWN, emptySquares.length));
    for (let i = 0; i < candidates.length; i++) {
        candidates[i]![1].shard = shardTypes[i] ?? "armor";
    }

    game.shardSpawnsDone += 1;

    return `Shards spawned: ${candidates.length} placed`;
}

// Call at the start of every turn. Handles the schedule, so it also works
// if a turn was skipped (e.g. the level-up rule consumes your next turn).
export function spawnShards(game: gameState): string {
    if (game.turnCount < game.shardTurn) {
        return "Not a shard spawn turn";
    }

    // catch up if turns were skipped, then schedule the next spawn
    const results: string[] = [];
    while (game.turnCount >= game.shardTurn) {
        results.push(attemptShardSpawn(game));
        game.shardTurn += SHARD_SPAWN_INTERVAL;
    }

    return results[results.length - 1] ?? "No shards spawned";
}
// star collection system
// ===== star system — an alternate win condition =====

const STAR_SPAWN_INTERVAL = 10;   // spawn a new star every 10 turns

// Squares eligible for a star, in priority order:
//   1. the four hot-zone squares (28,6 / 29,6 / 28,8 / 29,8) + the whole 7th row
//   2. the rest of the neutral zone (rows 4-10) as fallback
// A square is only eligible if nothing is on it: no piece, no brick,
// no shard, no star already.
export function starCandidates(game: gameState): string[] {
    const board = game.board;

    const isEmpty = (key: string, square: any): boolean =>
        !square.occupied && square.tenant === null && !square.bricked &&
        square.shard === undefined && square.star !== true;

    const byPriority = (key: string): number => {
        const [, r] = key.split(",").map(Number);
        // Hot-zone squares and the 7th row share top priority.
        if (starPrioritySquares.includes(key) || r === starRow) return 0;
        if (neutralZone.includes(r)) return 1;
        return 2;
    };

    const candidates = Object.entries(board)
        .filter(([key, square]) => isEmpty(key, square) && byPriority(key) <= 1)
        .sort((a, b) => byPriority(a[0]) - byPriority(b[0]));

    // Only place on the best available priority tier.
    if (candidates.length === 0) return [];
    const bestTier = byPriority(candidates[0]![0]);
    return candidates
        .filter(([key]) => byPriority(key) === bestTier)
        .map(([key]) => key);
}

// Spawn a single star, if scheduled and none is already on the board.
// Returns a message describing what happened, or null if nothing changed.
export function spawnStar(game: gameState): string | null {
    // A star never spawns while one is already on the board.
    const onBoard = Object.values(game.board).some(s => s.star === true);
    if (onBoard) {
        return null;
    }

    // Not a spawn turn yet.
    if (game.turnCount < game.starTurn) {
        return null;
    }

    const candidates = starCandidates(game);
    if (candidates.length === 0) {
        // No valid square — retry next turn.
        return null;
    }

    const key = candidates[Math.floor(Math.random() * candidates.length)]!;
    game.board[key]!.star = true;
    game.starTurn = game.turnCount + STAR_SPAWN_INTERVAL;
    return `Star spawned at ${key}`;
}

// Collect the star on the given square, crediting the owning affiliation.
// Returns true if a star was collected, false otherwise.
export function collectStar(position: [number, number], affiliation: "red" | "blue", game: gameState): boolean {
    const square = game.board[`${position[0]},${position[1]}`];
    if (!square || square.star !== true) {
        return false;
    }
    delete square.star;

    if (affiliation === "blue") {
        game.blueStars += 1;
    } else {
        game.redStars += 1;
    }

    // Schedule the next star to spawn 10 turns after this collection, not
    // on the old spawn schedule — so consuming a star resets the clock.
    game.starTurn = game.turnCount + STAR_SPAWN_INTERVAL;

    game.gameHistory.push({
        turn: game.turnCount,
        event: `${affiliation === "blue" ? "Blue" : "Red"} collected a star (${game[affiliation === "blue" ? "blueStars" : "redStars"]}/${game.starsToWin})`,
        player: affiliation,
    });

    return true;
}

// Check whether the star win condition has been met. Returns the winner,
// or null if the game is not yet decided by stars.
export function checkStarWin(game: gameState): "red" | "blue" | null {
    if (game.blueStars >= game.starsToWin) return "blue";
    if (game.redStars >= game.starsToWin) return "red";
    return null;
}
// bricking system
// effects selection