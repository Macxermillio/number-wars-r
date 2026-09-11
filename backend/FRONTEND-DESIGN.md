# Number Wars — Frontend Design

> **Status:** Working design · **Owner:** front-end implementation
> **Companion docs:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (server/contracts), [`number-chess-ruleset.md`](number-chess-ruleset.md) (game rules)
>
> This document is the UI/UX blueprint for the game page. It says what the
> player *sees, clicks, and understands*, and how the client realizes it from
> the `gameState` broadcasts that the server already sends (see
> `ARCHITECTURE.md §5.5 Stage 7` and §11 event map). It intentionally avoids
> re-specifying server behavior — that lives in ARCHITECTURE.md.


---

## 1. Design goals

1. **All info on screen, never in memory.** Every stat the player needs to
   make a decision is readable at a glance — no hidden menus, no hover-only
   data that matters.
2. **Obvious state.** The player always knows: whose turn it is, what the
   turn effect is, what is selected, and what a click will do *next*.
3. **Beginner-friendly strategy.** Ten rotating tips teach the intent
   behind each rule (merge to stack stats, hide glass cannons behind tanks,
   spike denial, chokepoints after turn 20, …) so new players start with a
   leg up instead of staring at a grid of numbers.
4. **Server-authoritative discipline.** The client is a pure renderer: it
   draws from `gameState` and sends *intents*. Selection and highlighting
   are local presentation layer only — they never mutate shared state and
   never contradict the last received board.

---

## 2. Screen layout

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER — Number Wars · room id · mode badge · opponent status  │
├────────────────────────────────────────────────────┬────────────┤
│                                                    │            │
│                    BOARD                           │  RIGHT     │
│            (13 rows × 16 columns)                  │  PANEL     │
│         tiles resize with viewport                 │            │
│                                                    │  • Turn    │
│                                                    │    effect  │
│                                                    │    + tips  │
│                                                    │            │
│                                                    │  • Selected│
│                                                    │    piece   │
│                                                    │    stats   │
│                                                    │    card    │
│                                                    │            │
├────────────────────────────────────────────────────┴────────────┤
│  FOOTER — game history feed · points · turn counter · bricks    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Zones at a glance

| Zone | Contents | Priority |
|---|---|---|
| **Header** | Logo, room id, mode badge (Friend / Computer / LLM), opponent status, "leave" | Not playing |
| **Right panel** | Turn effect banner + rotating strategy tip + selected-piece stats card | System state |
| **Board** | The 13×16 grid, pieces, shards, bricks, highlights, HUD overlaid per tile | Game state |
| **Footer** | Game history feed, points (capture score), turn counter, brick counter | History |

### 2.2 Layout algorithms

- **Turn effect banner** — a slim, full-width, colorful strip at the top of
  the right panel with the effect name and its action-model hint:
  - `Merge` — *(implicit — just move a piece onto an ally)*
  - `Split` / `Weaken` / `Strengthen` — *(explicit — click the effect, then a piece)*
- **Selected-piece card** — the most important piece of information; pinned
  at the top of the right panel when a piece is selected. Swaps instantly
  when the selection changes. Always visible on selection change.
- **Rotating tip** — slideshow at the bottom of the right panel. Shows a
  single tip; changes contextually every few seconds or on each turn.
- **HUD** — tiles render their own stats inline (see §3.2). The HUD is the
  primary way stats are visible "just from looking at the board", so the
  selected-piece card is the *detailed* companion, not the primary source.

---

## 3. Board rendering

### 3.1 The grid

- HTML/CSS grid, 16 columns × 13 rows; tiles are square and scale with the
  viewport.
- Coordinate mapping: `(column, row)` from `gameState.board` keys
  (`"21,1"` … `"36,13"`) map to grid cells directly.
- **Starting-row tinting** so players can see where pieces begin:
  - Rows 1–3 → subtle blue tint (Blue starting rows)
  - Rows 4–10 → neutral gray (open battlefield)
  - Rows 11–13 → subtle red tint (Red starting rows)
  - Tinting is visual only; either side may occupy any free, unbricked square.
- Bricked squares render as dark, chiseled, impassable tiles (cracked
  texture or ⬛ hatch pattern).

### 3.2 Piece tiles — "stats visible from looking at the board"

Serving the primary goal, every piece renders its **four core stats** right
on the tile, always — no hover, no context menu:

- **Strength** (attack power) — the big number in the tile's center
- **Range** (how many squares) — small number in the top-left corner
- **Armor** (defense) — small shield icon + number in the bottom-left
- **Spike** (counter-damage) — small chevron/spike icon + number in the
  top-right; empty (0) is dimmed

```
     ┌────────────┐
     │ R 2   ⚡ 3 │
     │    5       │   ← strength is the dominant visual
     │ 🛡 5       │
     └────────────┘
```

- **Affiliation is color:** number color + outline = affiliation
  - Blue pieces: blue number, blue/light border
  - Red pieces: red number, red/light border
- Only *show foreign objects* when they matter: a tile that has a **shard**
  (armor 🛡 / spike ⚡) shows a small pickup icon in the bottom-right; a
  tile that's **bricked** shows the brick marker (no stats — no piece).
- **Optional:** number value = the piece's *original* number (1–8) can be
  shown as a tiny index for flavor, but the four stats are the canonical
  readout.

### 3.3 HUD state legs

The board is *never* stale in the player's head:

| Condition | Rendering |
|---|---|
| **Not your turn** | Board is dimmed (overlay + reduced contrast); no interactions. |
| **Not your turn (opponent thinking)** | Dimmed + animated "Opponent is thinking…" indicator (only on Computer / LLM modes). |
| **Your turn** | Board is full-contrast; tiles are clickable. |
| **Game over** | Banner overlay «Blue / Red wins!» with points if it was a points win + a "new game" state. |

---

## 4. Selection model

**Single-source-of-truth problem:** the `gameState` broadcast has no piece
IDs (§6 refinement). The client derives a stable, per-status identity:

```ts
// client/js/select.ts (or inside render.ts)
type Selection = {
  affiliation: Affiliation;
  position: [number, number]; // board key of the piece
  strength: number;           // for sanity display
} | null;

let selection: Selection = null;
```

- Selection is **local presentation state** — it lives only in the client
  and is cleared on every incoming `gameState` (the server may have mutated
  the world; e.g. the piece moved, was captured, merged, or the turn
  flipped).
- Nothing about selection is ever sent to the server; it exists purely to
  disambiguate clicks.

### 4.1 Click model (the "click, click" contract)

- **Click a piece (it's your piece & it's your turn)** → select it
  - Highlight the piece.
  - If a different piece was selected, switch the selection.
- **Click the same selected piece again** → deselect
  - No highlight; subsequent clicks are free.
- **Click a destination square / enemy square** while a piece is selected
  → emit `move { roomId, pieceId, destination }` — exactly one move per
  selected piece; selection clears after the intent is sent:
  - This is the *first* click → the *next* click is a move direction.
- **Click anywhere else (empty tile, your other piece, enemy)** →
  - Empty tile: ignored (no selection) unless a piece is selected (then it
    is a move destination).
  - *Your* other piece on a non-Merge turn: re-select (switch selection).
  - *Enemy* piece on a **Merge turn**: **capture attempt** — allowed on any
    turn; clicking the enemy is a move intent (subject to validation).
  - *Enemy* piece on a **Split/Weaken/Strengthen** turn: move intent too
    (capture always allowed) — *or* if the effect is explicitly armed (you
    clicked the effect first), the enemy is a valid **Weaken/Strengthen
    target** instead (§6.3).
- **Click the effect button** (`Split` / `Weaken` / `Strengthen`) while it's
  your turn → arm the effect; the next click on a valid target applies it:

```
turn flow (your turn):
  ┌──────────────────────────────────────────────────────────────┐
  │ 1. click effect (Split/Weaken/Strengthen) → armed state      │
  │    · merge is implicit — no button                            │
  │ 2. click a valid target (ally or enemy)                      │
  │    · if effect is armed → useEffect intent, effect disarms   │
  │    · if effect is NOT armed → plain move intent (capture ok) │
  └──────────────────────────────────────────────────────────────┘
```

### 4.2 Highlight states (single piece, one at a time)

A selected piece is marked by a solid, high-contrast ring + soft glow (color
matches affiliation).

| State | Visual |
|---|---|
| **Unselected** | default tile, no ring |
| **Selected** | solid thick ring in the piece's affiliation color + glow |
| **Destination candidates** | (optional) translucent targets/squares in range; hovered candidate gets a brighter outline |
| **Armed effect** | the effect button glows; the "target any piece" hint pulses; click target to apply |

---

## 5. Selected-piece stats card (right panel)

Renders the full, current stats of the selected piece — *mirrored from the
last `gameState`*, not local guesses.

```
┌ Piece 5 — Blue ────────────────┐
│ ⭐ Strength   5                │
│ 🛡 Armor      5                │
│ ⚡ Spike      2  (cap 5)       │
│ 📏 Range      5                │
│                                │
│ [► effective power 5+5+2=12]   │
└────────────────────────────────┘
```

- **Spike cap** shown as `(cap 5)` next to the spike value — a player
  hoarding spikes on a strength-8 piece needs to see the cap *at a glance;*
  the same cap applies in the tile.
- **Effective power** (strength + armor + spike) — a single at-a-glance
  "how scary is this piece" number. This is *display-only*; it is not a
  rules concept.
- The card is **dismissed** when the piece is deselected or when the turn
  changes to the opponent's.
- Card also lists quick "what can I do" hints based on the current
  `turnEffect` (e.g. on Merge: *"You can merge into this piece"*).

---

## 6. Interaction states & the turn pipeline on the client

### 6.1 State machine (client-side)

```
idle ── select piece ──▶ selected ── select dest ──▶ intent sent (await ack)
 │        (click piece)      │        (click in range)
 │                           │
 │                           └── click same piece ──▶ idle (deselect)
 │
 └── (armed effect) ──▶ armed ── click valid target ──▶ intent sent (await ack)
```

- **Await ack:** after sending a `move` or `useEffect` intent, the client
  goes "pending" — it dims the board and waits for the authoritative
  `gameState` broadcast. No double-submit, no optimistic UI that could
  disagree with the server.
- **Validation errors** from the server (illegal move, not your turn, room
  expired) surface in the header as a red toast; the board state is never
  locally "corrected" — the client simply re-renders from the next
  `gameState` it receives.

### 6.2 Turn-effect widgets

| Effect | Client behavior |
|---|---|
| **Merge (30%)** | Implicit. No button. Hint in banner: "merge = move onto an ally". Selecting your piece highlights ally tiles as eligible merge targets; enemy tiles stay highlighted as capture candidates. |
| **Split (30%)** | Explicit. Button in the right panel. Armed → click your own piece (even strength only). Hint: "splits even strengths (2/4/6/8)". Invalid targets (odd strengths) show a rejection toast. |
| **Weaken (30%)** | Explicit. Button. Armed → click an ally *or* enemy piece, range irrelevant (effect targets any piece on the board). Hint: "drop 1 from every stat (min 1)". |
| **Strengthen (10%)** | Explicit. Button (rare so it pulses when it appears). Armed → click a piece; strength ×2, armor −gain. Hint: "doubles strength, costs armor". |

### 6.3 Armed effect vs move ambiguity

On **Split/Weaken/Strengthen** turns, both a move and an effect apply.
Client disambiguates by **armed state**:

- Effect **not armed** → clicking *any* piece means move intent (capture
  allowed) / reposition.
- Effect **armed** → clicking a *valid* piece-first applies the effect
  (the armed state is sticky until resolved or canceled, or until the turn
  flips on the next `gameState`).

The banner shows the current mode so the player never forgets which click
does what.

---

## 7. Right-panel tips system

### 7.1 Behavior

- A **rotating tip slideshow**: one tip visible at a time, auto-advances
  every ~8s; player can flip manually (prev/next arrows). Tips are
  **context-aware**: swap based on the current `turnEffect` and phase
  (early game = piece management; after turn 20 / bricks = positioning,
  shard economy at spawn turns).
- Tips are **copylight, not just flavor**: they state the *rule* and the
  *strategy* — a beginner learns both by osmosis.
- Placement: right panel, under the selected-piece card / under the turn
  effect banner (see §2 layout).
- The full tip pool lives in a client-side dictionary keyed by context
  (`turnEffect` × phase). The server need not know tips exist.

### 7.2 Tip pool

**Turn-effect tips (rotates while that effect is up):**

| Effect | Tip |
|---|---|
| Merge | "Merge combines two of your pieces into one. Strength and armor add together, and the merged piece keeps the better range. Tip: merge a low piece into a big one to make a tank." |
| Split | "Split divides a piece into two identical halves — only pieces with even strength (2, 4, 6, 8) can split. Tip: split your 8 to get two 4s that can flank an opponent." |
| Weaken | "Weaken drops 1 from strength, armor and range of a piece — yours or the enemy's. Spikes are untouched, never reduced. Tip: soften a tank before you attack it, or nerf the enemy's only strong piece." |
| Strengthen | "Strengthen doubles a piece's strength but costs armor for each point gained. Tip: only do it on pieces with armor to spare — an 8/0 can't survive a breeze." |

**Strategy tips (context, not tied to a single effect):**

| Theme | When | Tip |
|---|---|---|
| Tank + glass cannon | always | "Pieces 1–4 are tanks: low strength but high armor. Pieces 5–8 are glass cannons: big attack, thin armor. Protect your cannons with your tanks." |
| Spike awareness | when attaching/spiking | "Spikes hit the attacker *first*. A low piece covered in spikes can one-shot a super-strong piece — check the spike icon before you commit." |
| Spike denial | when near enemy spike shards | "A spike shard is eaten even by a piece at max spikes. Deny the enemy a spike pickup by taking it yourself, even if you can't use it." |
| Shard economy | at shard-spawn turns (every 5 turns) | "Shards spawn every 5 turns, 5 at a time. Armor shards stack forever; spike shards are capped by strength. Grab them early — they change board math." |
| Brick awareness | turn ≥ 20 | "From turn 20, a random square bricks each turn. The board shrinks — keep an escape route, and park a tank at a choke to control the middle." |
| Queen vs rook | when moving 1–4 vs 5–8 | "Pieces 1–4 move like queens (diagonal too). Pieces 5–8 are rooks — straight lines only. A diagonal it can't reach is a safe angle." |
| Capture math | when a capture is imminent | "You capture outright when your strength beats the defender's armor + strength + spikes. Do the armor math first, or you bounce off and waste a turn." |
| Points tiebreaker | late game | "If no one can win by elimination, points decide: your captured enemies' total value. Capture their 8 before your own 1 goes down." |
| Merge economy | when pieces are low | "Merging is the only way to beat the strength cap of 8. Combine your spare pieces — a hoard of 1s has no teeth." |
| Defensive merge | when opponent is strong | "An opponent with a big piece is easier to handle if you *merge* your own two strongest into a wall — armor stacks to 10." |

### 7.3 Context hook

The client derives tips from the broadcast `gameState`:

```ts
const tipId = pickTip({
  turnEffect: state.turnEffect,          // → effect tip
  turn: state.turnCount,                 // threshold tips (bricks at 20, shards at spawn turns)
  gameOver: state.gameOver,              // final "points math" tip
  lastCombat: lastGameHistoryEvent(state) // spike / capture / bounce context
});
```

---

## 8. Footer — history feed & scoreboard

- **Game history feed** — the last N (`≤50`) events from
  `state.gameHistory`, newest on top, each with turn number + affiliation
  color. This is where "Piece moved to 26,5", "Spikes shed after merge",
  and "Piece captured" narrate the game.
- **Points (capture score)** — computed client-side from the same history
  (or a future server field): sum of captured enemy piece *values* per
  player, displayed as `Blue 12 · Red 9`. This maps to the tiebreaker in
  `number-chess-ruleset.md §9`.
- **Turn counter** — `state.turnCount`.
- **Brick counter** — `state.bricks` (+ "max 80").

---

## 9. Client code organization

```
client/
├── index.html          # landing: rules + mode selection (unchanged concept)
├── play.html           # game page (reads roomId from URL)
├── css/
│   └── game.css        # grid, tiles, panels, banners, tip slideshow
└── js/
    ├── socket.ts       # socket.io-client wiring (ARCHITECTURE §11)
    ├── render.ts       # board rendering from gameState (pieces, shards, bricks)
    ├── select.ts       # selection model (§4) — client-only
    ├── tips.ts         # tip pool + context picker (§7)
    └── ui.ts           # menus, invite link, copy button, toasts, banner
```

- Selection (`select.ts`) is client-only and never talks to the server.
- `render.ts` is a pure function: `gameState → DOM`. All presentation state
  (selection, armed effect, tip index) sits outside it and is applied as
  overlays/highlights after the draw.
- The client sends only *intents* (`move` / `useEffect`) — never state — per
  ARCHITECTURE §1 ("clients are dumb renderers").

---

## 10. Open questions / follow-ups

1. **Piece identity** — current `gameState` has no `pieceId`; the client
   needs one (or the server adds a `pieceId` per piece and echoes it).
   Client-side derivation (position) is fragile across captures/merges.
   *Recommended:* add `pieceId` to `Piece` in the server refactor
   (`ARCHITECTURE §9`) and reflect it in the broadcast; selection then keys
   off `pieceId`.
2. **Move validation preview** — do we pre-validate legally-reachable
   destination squares and highlight them (nice UX), or only highlight on
   hover (with server toasts on illegal clicks)? *Recommended:* highlight
   legal destinations in-range when a piece is selected; it converts the
   stat readout into an actionable board.
3. **Tip rotation cadence** — 8s fixed? Or advance only on turn change?
   *Recommended:* both — advance on turn change; fall back to 8s in between.
4. **Touch targets** — 16-col board on mobile needs tiles ≥ 40px; consider
   a zoom/scroll mode. *Recommended:* CSS auto-scale; revisit if mobile is a
   priority.
5. **Sound / haptics** — out of scope for v1; note for future.
6. **OCR of stats** — we intentionally avoid icon-only stat readouts (R/A/S
   numbers are faster to parse than tiny icons); revisit only if icons get
   tooltips/persistent labels.

---

## 11. Appendix — point-by-point mapping to requirements

| Requirement | Where it lands in this doc |
|---|---|
| Piece stats visible from looking at the board | §3.2 tile HUD (always-on stat chips) |
| Click piece → highlighted; click again → deselect | §4.1 click model + §4.2 highlight ring |
| Next click after selecting = move direction | §4.1 "click, click" contract |
| Selected-piece stats outside the board | §5 stats card in right panel |
| Turn-effect-driven tips slideshow | §7 tips system, context-keyed |
| Beginner leg up | §7.2 tip pool + §3.2 at-a-glance stats |