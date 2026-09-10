import OpenAI from "openai";
import { cloneState, legalActions, applyAction } from "./simulation.ts";
import type { AiAction } from "./simulation.ts";

// LLM opponent for Number Wars
// Follows the book-condenser pattern: AsyncOpenAI client with OpenRouter,
// model fallback, retry logic, structured prompt generation.

// Bake defaults: model, base URL, fallback chain
const MODEL = process.env.LLM_MODEL || "deepseek/deepseek-v4-flash";
const BASE_URL = process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1";
const API_KEY = process.env.LLM_API_KEY || "";
const FALLBACK_MODELS = [
    "xiaomi/mimo-v2.5",
    "deepseek/deepseek-v4-pro",
];

const MAX_RETRIES = 3;

// High-effort reasoning for stronger play (OpenRouter unified `reasoning` param).
const REASONING_EFFORT = process.env.LLM_REASONING_EFFORT || "high";

let client: OpenAI | null = null;

function getClient(): OpenAI {
    if (!client) {
        client = new OpenAI({
            baseURL: BASE_URL,
            apiKey: API_KEY,
        });
    }
    return client;
}

// Serialize the game state into a text description the LLM can understand.
// We include board layout, piece stats, turn info, and available actions.
export function describeState(state: any): string {
    const lines: string[] = [];
    const { turn, turnEffect, turnCount, board, redPieces, bluePieces, bricks, gameOver, gameWinner } = state;

    lines.push(`Turn: ${turn} (turn ${turnCount})`);
    lines.push(`Turn effect: ${turnEffect}`);
    if (bricks > 0) lines.push(`Bricks on board: ${bricks}`);
    const starInfo = `Stars: RED ${state.redStars ?? 0}/${state.starsToWin ?? 10} — BLUE ${state.blueStars ?? 0}/${state.starsToWin ?? 10}`;
    lines.push(starInfo);
    if (gameOver) {
        lines.push(`Game over! Winner: ${gameWinner}`);
        return lines.join("\n");
    }

    // Describe each side's pieces
    lines.push("\nYour pieces (RED):");
    for (const p of redPieces) {
        const pos = p.position;
        const spikeCap = Math.max(2, 10 - p.strength);
        const moveType = p.strength >= 5 ? "rook" : "queen";
        lines.push(`  Piece at (${pos[0]}, ${pos[1]}): S=${p.strength} A=${p.armor} Sp=${p.spike}(${spikeCap}) R=${p.range} [${moveType}]${p.strength >= 5 ? " — straight lines only" : " — 8 directions"}`);
    }

    lines.push("\nEnemy pieces (BLUE):");
    for (const p of bluePieces) {
        const pos = p.position;
        const spikeCap = Math.max(2, 10 - p.strength);
        const moveType = p.strength >= 5 ? "rook" : "queen";
        lines.push(`  Piece at (${pos[0]}, ${pos[1]}): S=${p.strength} A=${p.armor} Sp=${p.spike}(${spikeCap}) R=${p.range} [${moveType}]`);
    }

    // Describe board layout briefly (starting rows, bricks, shards).
    // Starting rows are not restricted territory: either affiliation may
    // occupy any free, unbricked square.
    lines.push("\nBoard: 13 rows (1-13), 16 columns (21-36)");
    lines.push("  Rows 1-3: Blue starting rows | Rows 4-10: open field | Rows 11-13: Red starting rows");
    lines.push("  There are no safety or territory restrictions: red and blue may enter any free, unbricked square.");
    lines.push("  Pieces 1-4 move like queens (any direction), pieces 5-8 move like rooks (straight only)");
    const shardList = Object.values(board)
        .filter((sq: any) => sq?.shard)
        .map((sq: any) => `    ${sq.shard} shard at (${sq.col}, ${sq.row})`);
    if (shardList.length > 0) {
        lines.push(`  Shards on board: ${shardList.length}`);
        lines.push(...shardList);
    }

    const stars = Object.entries(board)
        .filter(([, sq]: any) => sq?.star === true)
        .map(([key]) => `    star at (${key.replace(",", ", ")})`);
    if (stars.length > 0) {
        lines.push(`  ⭐ STARS on board (collect by landing on it):`);
        lines.push(...stars);
    }

    // Full move history — the same battle-report events the human sees in
    // the Move History feed. Gives the model memory: who moved where, what
    // was captured/chipped/merged, which effects were used. Oldest first so
    // the sequence reads chronologically. The backend keeps the complete
    // log (no trimming); we send it all — entries are short strings and
    // even a 300-turn game is only ~30-40k chars, well within context.
    const history = Array.isArray(state.gameHistory) ? state.gameHistory : [];
    lines.push(`\nFull move history (${history.length} entries, oldest first — same events the human sees):`);
    if (history.length === 0) {
        lines.push("  (game just started — no moves yet)");
    } else {
        for (const h of history) {
            const who = h.player ? `[${String(h.player).toUpperCase()}] ` : "";
            lines.push(`  T${h.turn} ${who}${h.event}`);
        }
    }

    // Concrete legal move options — gives the model the board facts instead
    // of making it visualize the grid.
    lines.push("\nYour legal options this turn (choose exactly one):");
    const options = legalActions(state, "red");
    if (options.length === 0) {
        lines.push("  (none — no legal move found)");
    } else {
        for (const o of options) {
            if (o.type === "move") {
                const square = state.board[`${o.to[0]},${o.to[1]}`];
                lines.push(`  MOVE (${o.from[0]},${o.from[1]}) → (${o.to[0]},${o.to[1]})${square?.tenant ? ", CAPTURE/MERGE" : square?.star ? ", ⭐ STAR" : square?.shard ? ", SHARD" : ""}`);
            } else {
                lines.push(`  EFFECT ${o.type.toUpperCase()} target (${o.target[0]},${o.target[1]})`);
            }
        }
    }

    return lines.join("\n");
}

// Compute every legal (from, to) for one affiliation right now, mirroring the
// server's validateMove + merge rules. Cheap: max 8 pieces × 8 dirs × 8 range.
function computeLegalMoveOptions(state: any, affiliation: string): { from: [number, number]; to: [number, number]; strength: number; capture?: boolean; merge?: boolean; shard?: boolean; star?: boolean }[] {
    const pieces = affiliation === "red" ? state.redPieces : state.bluePieces;
    if (!Array.isArray(pieces)) return [];
    const isMergeTurn = state.turnEffect === "Merge";
    const out: { from: [number, number]; to: [number, number]; strength: number; capture?: boolean; merge?: boolean; shard?: boolean; star?: boolean }[] = [];

    for (const p of pieces) {
        const [c, r] = p.position;
        const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        if (p.strength < 5) dirs.push([-1, -1], [1, -1], [-1, 1], [1, 1]);

        for (const [dc, dr] of dirs) {
            for (let d = 1; d <= p.range; d++) {
                const tc = c + dc * d;
                const tr = r + dr * d;
                if (tc < 21 || tc > 36 || tr < 1 || tr > 13) break;
                const sq = state.board?.[`${tc},${tr}`];
                if (!sq || sq.bricked) break; // blocked — can't pass through
                if (sq.tenant) {
                    if (sq.tenant.affiliation === affiliation) {
                        // Ally: only usable on Merge turns.
                        if (isMergeTurn) out.push({ from: [c, r], to: [tc, tr], strength: p.strength, merge: true });
                        break; // ally blocks movement
                    }
                    // Enemy: capture attempt (risky, but legal).
                    out.push({ from: [c, r], to: [tc, tr], strength: p.strength, capture: true });
                    break; // can't pass through
                }
                out.push({ from: [c, r], to: [tc, tr], strength: p.strength, shard: !!sq.shard, star: !!sq.star });
            }
        }
    }
    return out;
}

// Build the system prompt that teaches the LLM how to play
function buildSystemPrompt(): string {
    return `You are playing Number Wars, a turn-based strategy game on a 13×16 grid. You control RED.

# The Board
- Grid: 13 rows (1-13) × 16 columns (21-36).
- Rows 1-3 are Blue's starting rows. Rows 11-13 are Red's starting rows. Rows 4-10 are the open field. These are not safety zones or restricted territory: either side may move onto any free, unbricked square.
- Squares can be occupied by a piece, empty, bricked (permanent, impassable), hold a shard (pickup), or hold a star (⭐ pickup — alternate win).

# The Pieces
You and Blue each start with 8 pieces (values 1-8) placed randomly in your safe zones. Each piece has 4 stats:
- Strength (S) = value = attack power = max movement distance
- Armor (A) = 10 - value (low pieces are tanky, high pieces are glass cannons)
- Spike (Sp) = counter-damage, gained from spike shards
- Range (R) = value = how many squares it can move

| Value | S | A | R |
|-------|---|---|---|
| 1 | 1 | 9 | 1 |
| 2 | 2 | 8 | 2 |
| 3 | 3 | 7 | 3 |
| 4 | 4 | 6 | 4 |
| 5 | 5 | 5 | 5 |
| 6 | 6 | 4 | 6 |
| 7 | 7 | 3 | 7 |
| 8 | 8 | 2 | 8 |

Movement:
- Pieces 1-4 move like QUEENS: 8 directions (orthogonal + diagonal), any distance 1..R along a clear path.
- Pieces 5-8 move like ROOKS: 4 orthogonal directions only, any distance 1..R along a clear path.
- A piece cannot move 0 squares (a move must end on a DIFFERENT square) and cannot jump over ANY occupied or bricked square — the path must be clear.

# Turn Structure
Each turn has a random global effect:
- Merge (30%): move onto an ALLY to combine them (implicit — no button).
- Split (30%), Weaken (30%), Strengthen (10%): usable through an explicit action, or you may IGNORE the effect and move instead.
- You may ALWAYS ignore the turn effect and simply move a piece for repositioning.
- CAPTURE is always legal on any turn — moving onto an enemy always resolves combat.

# Merge (only on Merge turns)
To merge, move your piece along a clear path onto an ALLY piece.
Result at the destination: S = sum (capped 8), A = sum (capped 10), R = max of the two ranges, Spikes = sum then shed to the cap for the new strength (cap = 10 - new S, minimum 2).

# Combat (Capture)
When you move onto an enemy:
1. Spike phase: defender's spikes hit you, absorbed by your armor first, then your strength. If your strength hits 0 you DIE to spikes (your attack fails). Spikes used are consumed from the defender.
2. If your remaining strength > defender's (A + S + Spikes), the defender is CAPTURED outright.
3. Otherwise: your strength chips the defender's armor. If armor holds (A - S >= 0), you BOUNCE back adjacent to the defender (attacker loses nothing). If it breaks (A - S < 0), leftover power reduces the defender's S: if leftover >= defender's S, CAPTURED; else defender's S is reduced and you are REPELLED back to start.

# Stat Caps & Shards
- S max 8, A max 10 (merges). Spike cap = 10 - S.
- Shards spawn every 5 turns: 5 shards per spawn (armor and spike). Armor shard: +1 A (no cap). Spike shard: +1 Sp (capped; over-cap still consumes the shard — denial).
- Bricks begin appearing ONE per turn starting at turn 20, on random non-bricked squares. They are permanent and impassable. The board shrinks over time.

# Win Condition
There are TWO ways to win:
1. Eliminate all of the enemy's pieces (captured or killed by spikes). If mutual elimination is impossible, points (total value of enemy pieces you captured) decide the winner.
2. ⭐ STAR COLLECTION — be the first to collect 10 stars. A star spawns every 10 turns in the center of the board (rows 4-10, especially the 7th row and the four center squares) and only one exists at a time. To collect it, a piece must LAND on the star's square. Stars do not block movement. Landing on a star is a strong alternative path to victory — especially when you're behind in pieces.

# Your Action
Choose exactly one action from the legal-options list. Return ONLY valid JSON, no explanation, no markdown.
Move: {"action":"move","from_col":N,"from_row":N,"to_col":N,"to_row":N}
Effect: {"action":"split|weaken|strengthen","target_col":N,"target_row":N}

STRATEGY:
- Prefer captures you can win: your effective strength (S minus enemy spike damage) must beat their A+S+spikes. A tank with high armor beats a low attacker (you bounce off and lose nothing).
- Avoid moving onto strong spiky enemies — a 1 with 4 spikes can kill an 8/1 attacker.
- Pick up shards when safe (armor is always good; spike shards are best on low-S pieces that have spike slots).
- ⭐ COLLECT STARS when you can reach one safely — 10 wins the game. If you're ahead on the elimination path, deny stars to Blue by moving toward them. Stars are marked in your legal-options list.
- Watch for merge opportunities on Merge turns: combining low pieces makes an 8/10/rook with max range.
- Late game the board shrinks: avoid getting your pieces pinned against bricks.
- Use the Full move history section: it shows every Blue move, capture, and effect so far — exploit weakened enemies it reveals, avenge lost pieces, and don't walk into a threat that just appeared.
- Use the legal-options list — moves NOT on that list will be rejected by the server.`;
}

export interface AiMoveOptions {
    // If the server rejected the previous move, pass the error here so the
    // LLM can correct itself instead of repeating the same illegal move.
    lastError?: string | undefined;
}

export type AiLlmAction =
    | { action: "move"; from_col: number; from_row: number; to_col: number; to_row: number }
    | { action: "split" | "weaken" | "strengthen"; target_col: number; target_row: number };

// Call the LLM to get a move. Returns a promise with the chosen move or null.
export async function getAiMove(state: any, opts: AiMoveOptions = {}): Promise<AiLlmAction | null> {
    if (!API_KEY) {
        console.warn("[LLM] No LLM_API_KEY set — AI opponent will make legal random moves");
        return getSafeFallback(state);
    }

    const forced = findImmediateAiAction(state);
    if (forced) return forced;
    const description = describeState(state);
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: `Current game state:\n${description}\n\nWhat is your move? Return only valid JSON.` },
    ];

    // If the previous move was rejected, tell the LLM why and ask it to retry.
    if (opts.lastError) {
        messages.push({
            role: "assistant",
            content: '{"action":"move","from_col":0,"from_row":0,"to_col":0,"to_row":0}',
        });
        messages.push({
            role: "user",
            content: `Your previous action was rejected by the game server: "${opts.lastError}".\nChoose an action from the legal-options list. Return ONLY valid action JSON using the required schema.`,
        });
    }

    const c = getClient();

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await c.chat.completions.create({
                model: MODEL,
                extra_body: { models: FALLBACK_MODELS, reasoning: { effort: REASONING_EFFORT, exclude: true } },
                // Top-level `reasoning` for SDKs that forward unknown params;
                // cast keeps TS happy on openai@4 typings.
                ...( { reasoning: { effort: REASONING_EFFORT, exclude: true } } as any ),
                messages,
                temperature: 0.7,
            });

            const content = response.choices?.[0]?.message?.content?.trim();
            if (!content) continue;

            // Parse JSON out of the response (strip markdown fences if present)
            let json = content;
            if (json.startsWith("```")) {
                json = json.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
            }
            const parsed = JSON.parse(json);

            // Validate shape
            if (isValidShape(parsed)) {
                console.log(`[LLM] AI chooses ${parsed.action}`);
                return parsed;
            }

            // If invalid format, tell the LLM and retry
            messages.push({ role: "assistant", content });
            messages.push({ role: "user", content: `Invalid format. Return only a valid move or effect JSON action.` });

        } catch (err: any) {
            console.warn(`[LLM] Attempt ${attempt + 1} failed: ${err.message}`);
            if (attempt === MAX_RETRIES - 1) {
                return getSafeFallback(state);
            }
        }
    }

    return getSafeFallback(state);
}

function isValidShape(value: any): value is AiLlmAction {
    if (value?.action === "move") return [value.from_col, value.from_row, value.to_col, value.to_row].every((n) => typeof n === "number");
    return ["split", "weaken", "strengthen"].includes(value?.action) && typeof value.target_col === "number" && typeof value.target_row === "number";
}

function toLlmAction(action: AiAction): AiLlmAction {
    return action.type === "move"
        ? { action: "move", from_col: action.from[0], from_row: action.from[1], to_col: action.to[0], to_row: action.to[1] }
        : { action: action.type, target_col: action.target[0], target_row: action.target[1] };
}

function findImmediateAiAction(state: any): AiLlmAction | null {
    for (const action of legalActions(state, "red")) {
        const sim = cloneState(state);
        if (applyAction(sim, action).error) continue;
        if (sim.redStars >= (sim.starsToWin || 10) || sim.bluePieces.length === 0) return toLlmAction(action);
    }
    return null;
}

function getSafeFallback(state: any): AiLlmAction | null {
    const action = legalActions(state, "red").find((candidate) => {
        const sim = cloneState(state);
        return !applyAction(sim, candidate).error;
    });
    return action ? toLlmAction(action) : null;
}

// Fallback: pick a random LEGAL move. Never returns a move that the server
// would reject — scans all pieces/directions/distances and filters out
// bricked, out-of-range, blocked-path, and ally-occupied destinations.
function getRandomMove(state: any): { from_col: number; from_row: number; to_col: number; to_row: number } | null {
    if (!state?.board || !Array.isArray(state.redPieces)) return null;
    const ourPieces = state.redPieces.filter((p: any) => Array.isArray(p.position));
    if (ourPieces.length === 0) return null;

    const candidates: { from_col: number; from_row: number; to_col: number; to_row: number }[] = [];

    for (const piece of ourPieces) {
        const [c, r] = piece.position;
        const isRook = piece.strength >= 5;
        const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        if (!isRook) dirs.push([-1, -1], [1, -1], [-1, 1], [1, 1]);

        // Scan each direction, stopping at the first blocker (brick/edge/ally)
        // — same rule the server uses for path validation.
        for (const [dc, dr] of dirs) {
            for (let d = 1; d <= piece.range; d++) {
                const tc = c + dc * d;
                const tr = r + dr * d;
                if (tc < 21 || tc > 36 || tr < 1 || tr > 13) break;
                const sq = state.board[`${tc},${tr}`];
                if (!sq || sq.bricked) break; // blocked — can't pass through
                if (sq.tenant) {
                    if (sq.tenant.affiliation === piece.affiliation) break; // ally blocks
                    // Enemy = legal capture (spike risk is up to the player)
                    candidates.push({ from_col: c, from_row: r, to_col: tc, to_row: tr });
                    break; // can't move past an enemy
                }
                candidates.push({ from_col: c, from_row: r, to_col: tc, to_row: tr });
            }
        }
    }

    if (candidates.length === 0) {
        console.warn("[LLM] No legal random move available");
        return null;
    }

    const choice = candidates[Math.floor(Math.random() * candidates.length)]!;
    console.log(`[LLM] Random legal move: (${choice.from_col},${choice.from_row}) → (${choice.to_col},${choice.to_row})`);
    return choice;
}

// Strictly validates a move against the game ruleset UNLESS the current turn
// effect is Merge (where landing on an ally is the whole point). Mirrors the
// server's processMoveIntent + move() checks without mutating any state.
// Returns the rejection reason (non-empty) or null (move is legal).
export function validateAiMove(
    state: any,
    fromCol: number, fromRow: number, toCol: number, toRow: number
): string | null {
    // Turn check (red is the AI in ai mode).
    if (state.turn !== "red") return `It's not your turn (it is ${state.turn})`;

    const piece = (state.redPieces || []).find(
        (p: any) => p.position[0] === fromCol && p.position[1] === fromRow
    );
    if (!piece) return "No piece found at that position";

    const board = state.board;
    const destKey = `${toCol},${toRow}`;
    const dest = board?.[destKey];

    // Same-square moves are never legal (path length would be 0/not-a-line).
    if (fromCol === toCol && fromRow === toRow) return "Piece must move to a different square";

    // Destination must exist and not be bricked.
    if (!dest || dest.bricked) return "Destination square is bricked or does not exist";

    // Merge turns allow landing on an ally; all other turns forbid it.
    const allyOccupied = dest.tenant && dest.tenant.affiliation === "red";
    if (allyOccupied && state.turnEffect !== "Merge") {
        return "Cannot land on an ally piece — only allowed on Merge turns";
    }
    if (allyOccupied && state.turnEffect === "Merge") return null; // valid merge

    // Direction: all pieces move orthogonally; S<5 pieces may also move on
    // true diagonals. Knight-like offsets are never legal.
    const cx = toCol - fromCol;
    const ry = toRow - fromRow;
    if (piece.strength >= 5 && cx !== 0 && ry !== 0) {
        return "Piece can only move in straight lines";
    }
    if (piece.strength < 5 && cx !== 0 && ry !== 0 && Math.abs(cx) !== Math.abs(ry)) {
        return "Piece must move in a straight line or diagonal";
    }

    // Distance within range.
    const distance = Math.max(Math.abs(cx), Math.abs(ry));
    if (piece.range < distance) return "Piece can't move that far";

    // Path must be clear (no bricked/occupied intermediate squares).
    const stepC = cx === 0 ? 0 : cx / Math.abs(cx);
    const stepR = ry === 0 ? 0 : ry / Math.abs(ry);
    for (let i = 1; i < distance; i++) {
        const s = board[`${fromCol + stepC * i},${fromRow + stepR * i}`];
        if (!s || s.bricked || s.occupied) return "Path is obstructed, choose another destination";
    }

    return null;
}

// Server-side fallback: a move that is guaranteed legal under the current
// rules (no LLM involved). Reuses getRandomMove's legality scanning, then
// double-checks with validateAiMove. On Merge turns it can pick a merge.
export function legalRandomMove(state: any): { from_col: number; from_row: number; to_col: number; to_row: number } | null {
    const base = getRandomMove(state);
    if (!base) return null;

    const err = validateAiMove(state, base.from_col, base.from_row, base.to_col, base.to_row);
    if (!err) return base;

    // First candidate failed a strict check — retry N times, then give up.
    for (let i = 0; i < 50; i++) {
        const m = getRandomMove(state);
        if (!m) return null;
        if (!validateAiMove(state, m.from_col, m.from_row, m.to_col, m.to_row)) return m;
    }
    console.warn("[LLM] legalRandomMove: exhausted retries without a strictly-legal move");
    return null;
}