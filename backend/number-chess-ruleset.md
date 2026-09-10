# Number Chess — Complete Ruleset

## 1. The Board

- **Grid:** 13 rows × 16 columns
- **Rows 1–3:** Player A's starting rows
- **Rows 11–13:** Player B's starting rows
- **Rows 4–10:** Open field between the starting rows

The starting rows are not protected territory. After setup, any red or blue
piece may move onto any free, unbricked square on the board. The row groupings
only describe where pieces begin; they do not restrict movement or captures.

## 2. The Pieces

Each player has **8 pieces**, numbered **1 through 8**. Each piece has four stats:

| Piece | Strength | Armor | Spike | Range |
|-------|----------|-------|-------|-------|
| 1 | 1 | 9 | 0 | 1 |
| 2 | 2 | 8 | 0 | 2 |
| 3 | 3 | 7 | 0 | 3 |
| 4 | 4 | 6 | 0 | 4 |
| 5 | 5 | 5 | 0 | 5 |
| 6 | 6 | 4 | 0 | 6 |
| 7 | 7 | 3 | 0 | 7 |
| 8 | 8 | 2 | 0 | 8 |

- **Strength** = the piece's value (attack power)
- **Armor** = 10 − value (defense — low pieces are tanky, high pieces are glass cannons)
- **Spike** = counter-damage, starts at 0 and is gained from spike shards (see §7)
- **Range** = value (movement distance)

All pieces move **like rooks** — any of the 4 orthogonal directions (up, down, left, right).

**Exception — pieces 1–4 move like queens:** Values 1 through 4 can also move diagonally (all 8 directions like a chess queen). Values 5–8 are restricted to orthogonal (rook) movement only.

A piece may move **0 up to its value** squares per turn (e.g. a 5 can move 0, 1, 2, 3, 4, or 5 squares). Movement must be in a straight line and **cannot pass through occupied squares** (friendly or enemy). Landing on an enemy square is always a **capture attempt** — capture is possible on **any** turn, regardless of the turn effect. Landing on a friendly square is only allowed on a **Merge** turn (it performs the merge); on all other turns it is not allowed.

**Movement examples:**
- A **5** at (21,5) can move up to 5 squares orthogonally — to (26,5), (21,10), or anywhere in between, as long as the path is clear.
- A **3** at (21,5) can move diagonally — to (24,8) — because pieces 1–4 move like queens.
- A **7** at (21,5) cannot move to (24,8) — pieces 5–8 are rook-only, so diagonal movement is illegal.
- A **4** at (21,5) cannot move to (26,5) — that's 5 squares, beyond its range of 4.

## 3. Setup

1. Player A starts in rows 1–3. Player B starts in rows 11–13.
2. Each player's 8 pieces are placed **randomly across their 3 starting rows** (rows 1–3 for Blue, rows 11–13 for Red) in random positions and random order. No two games begin the same. These rows impose no movement restriction after setup.

## 4. Stat Caps

**Strength is capped at 8.** Merges, strengthens, and any other strength increases never exceed 8. The 8 is king — the maximum possible piece on the board.

**Armor is capped at 10** (enforced on merge). Armor is the **only stat that stacks uncapped** — armor shards can push armor arbitrarily high with no cap on pickup.

**Spikes are capped by strength.** A piece's maximum spike count depends on its current strength:

| Strength | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|----------|---|---|---|---|---|---|---|---|
| Max spikes | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 |

A piece at its cap that steps on a spike shard still **consumes the shard** (denial — blocking the opponent from using it later), but its spike count never exceeds the cap.

**Spike cap examples:**
- A **1** (cap 9) can hoard 9 spikes — a walking minefield.
- An **8** (cap 2) can only carry 2 spikes — its strength leaves little room for counter-damage.
- An **8** with 2 spikes steps on a spike shard: the shard is consumed (denied to the opponent), but the 8 stays at 2 spikes.

## 5. Turn Structure

Each turn, a **global random operation** is assigned from four effects, by weight:

| Effect | Meaning | Weight |
|--------|---------|--------|
| **Merge** | Addition (➕) | 30% |
| **Split** | Division (➗) | 30% |
| **Weaken** | Subtraction (➖) | 30% |
| **Strengthen** | Multiplication (✖️) | 10% (rare) |

On any turn, a player may choose to **ignore the operation** and simply move a piece without using the special effect. This is always allowed — a turn can be used purely for repositioning.

**Activation model:**
- **Merge** is **implicit** — no explicit activation. Moving onto an enemy square is an attack; moving onto an ally square performs the merge.
- **Split, Weaken, and Strengthen** require **explicit activation** — the player clicks the effect, then clicks a target piece. Until activated, the turn behaves like a normal move turn.

**Capture is always available** on every turn, regardless of the effect — moving onto an enemy square always resolves combat (§8).

### 5.1 Merge (➕) — *Addition*

Merge **two of your own pieces** into one piece. The first piece moves along a clear path to reach the second; both are consumed and replaced by the merged piece at the second piece's square.

**Activation:** Merge is **implicit** — there is no explicit "use merge" button. Moving a piece onto an **enemy** square is treated as an attack (capture, see §8); moving a piece onto an **ally** square performs the merge. The normal move for this turn is replaced by the merge.

- **Strength** = sum of the two strengths (capped at 8)
- **Armor** = sum of the two armors (capped at 10)
- **Range** = the higher of the two ranges
- **Spikes** = sum of the two spike counts, then **shed down** to the merged piece's cap for its new strength (e.g. 1 + 7 → strength 8 → cap 2)

**Merge example:** Merge a **3** (3/7/0) into a **5** (5/5/0):
- Strength = 3 + 5 = **8** (capped)
- Armor = 7 + 5 = **10** (capped)
- Range = max(3, 5) = **5**
- Result: an **8/10/0** piece.

If the 3 had 4 spikes and the 5 had 2 spikes: merged spikes = 6, but strength 8 caps at 2 → **sheds to 2 spikes**.

### 5.2 Weaken (➖) — *Subtraction*

Reduce **one piece's** stats by 1 each (minimum 1). Works on both ally and enemy pieces.

**Activation:** Requires **explicit activation** — click the Weaken effect, then click a target piece (ally or enemy). Until activated, the turn is a normal move turn.

- **Strength** − 1 (min 1)
- **Armor** − 1 (min 1)
- **Range** − 1 (min 1)
- **Spikes** are untouched — never reduced, nothing is shed (lowering strength raises the cap by 1, so there is room for 1 more spike)

A piece at 1/1/1 is **invulnerable** to this effect — only a 1 is unaffected by Weaken.

**Weaken examples:**
- Weaken a **5/5/5** → **4/4/4** (spike cap rises from 5 to 6).
- Weaken a **1/9/1** → **1/8/1** (strength and range are already at minimum 1, so only armor drops; cap stays 9).
- Weaken a **1/1/1** → rejected — the piece is invulnerable.
- Weaken a **2/8/2** carrying 8 spikes → strength drops to 1, so the cap rises from 8 to 9 — no clamping needed (the cap rose).

### 5.3 Split (➗) — *Division*

Split a piece into two pieces. The piece's stats are **halved**, and a copy with the same stats is created on an **adjacent empty square**. If no adjacent empty square exists, the split fails.

**Activation:** Requires **explicit activation** — click the Split effect, then click a target piece. Until activated, the turn is a normal move turn.

- **Strength** = half (e.g. 8 → 4)
- **Armor** = half, rounded down
- **Range** = half
- **Spikes** = half, rounded down (e.g. a 3-spike piece splits into two 1-spike pieces). The original piece and the new copy each get the halved value — no cap check needed because the new pieces are weaker and have more spike slots.

Only works on **even strengths** (2, 4, 6, 8). Odd strengths cannot split — and a failed split changes nothing.

| Original | Result |
|----------|--------|
| 2 | two 1s |
| 4 | two 2s |
| 6 | two 3s |
| 8 | two 4s |

**Split examples:**
- Split an **8** (8/2/8) → two **4s** (4/1/4).
- Split a **6** carrying 3 spikes → two **3s** carrying **1 spike each** (3 ÷ 2, rounded down).
- Split a **3** → rejected — odd strengths cannot split, and the piece is unchanged.

### 5.4 Strengthen (✖️) — *Multiplication*

The **rarest** turn type. Doubles one piece's strength, capped at 8, at the cost of armor:

**Activation:** Requires **explicit activation** — click the Strengthen effect, then click a target piece. Until activated, the turn is a normal move turn.

- **Strength** = doubled (capped at 8)
- **Armor** = reduced by the amount of strength gained (minimum 0)
- **Spikes** shed to the new strength's cap. Since raising strength **lowers** the spike cap (cap = 10 − strength), Strengthen can shed spikes — the cost is both armor *and* any excess spikes.

| Before | After |
|--------|-------|
| 1 | 2 (armor −1) |
| 2 | 4 (armor −2) |
| 3 | 6 (armor −3) |
| 4 | 8 (armor −4) |
| 5+ | 8 (capped) |
| 8 | no change — effect can't be used |

**Strengthen examples:**
- Strengthen a **3/7/3** → **6/4/3** (strength doubled to 6, armor reduced by the 3 gained; spikes 3 ≤ cap 4, so unchanged).
- Strengthen a **5/5/5** → **8/2/5** (strength capped at 8, armor reduced by 3).
- Strengthen a **4/2/4** → **8/0/4** (armor reduced by 4, floor of 0).
- Strengthen a **3** carrying **6 spikes** → strength 6 (cap 4) → spikes shed to **4** — Strengthen costs armor *and* 2 spikes.
- Strengthen an **8** → rejected — already at max strength.

---

## 6. Bricks

Bricks constrict the battlefield over time. Each brick is a permanent, impassable square — no piece can move onto or through it.

- Bricks start appearing at **turn 20** — turns 1–19 are brick-free, so the early game stays wide open.
- Bricks are placed **one at a time** on a random **non-bricked** square, starting from turn 20.
- They are **permanent**.
- Bricks stop appearing once **80 squares** are bricked (the hard cap — no square gets bricked beyond it).

**Design intent:** The board slowly shrinks over the match. Early game is wide maneuvering; late game is chokepoints, ambushes, and small pieces pincering larger ones against brick walls.

**Brick example:** With 80 bricks on the 208-square board (~38% coverage), a once-open corridor between the two sides can become a single-file passage — a strong piece parked at the choke can hold it against everything.

## 7. Shards

Shards are collectible pickups that spawn on empty squares (not occupied, not bricked, not already containing a shard). There are two types:

| Shard | Effect on pickup |
|-------|------------------|
| **Armor** | Piece gains +1 armor (uncapped — armor is the only stat that stacks freely) |
| **Spike** | Piece gains +1 spike (capped by strength, see §4) |

**Spawn schedule:**
- Shards spawn every **5 turns**.
- Each spawn places **5 shards**, split **3:2** — either 3 armor + 2 spike, or 3 spike + 2 armor (randomly chosen).
- Spawning stops after **10 spawns** total.
- If **10 shards** are already on the board, a spawn is skipped.

**Pickup & denial:** A piece that moves onto a shard square consumes it. The shard is always consumed even if the piece is at its spike cap (denial — it blocks the opponent from getting it), but a spike gain never pushes a piece past its cap.

**Design intent:** Shards are the economy of the game. Armor shards are pure upside (uncapped). Spike shards are a limited resource capped by strength — a low-strength piece can carry many spikes, while a high-strength piece has few slots. Denying a spike from a strong enemy piece can be as valuable as taking it yourself.

**Shard examples:**
- A **4** (cap 6) carrying 5 spikes picks up a spike shard → **6 spikes** (at cap).
- A **4** at cap 6 picks up another spike shard → shard consumed (denied), still **6 spikes**.
- A **1** picks up an armor shard → armor 9 → **10** (armor stacks uncapped).

---

## 8. Combat (Capture)

Combat triggers when a piece moves onto an enemy-occupied square. **Capture is always possible on any turn** — the turn effect never restricts it. It resolves in this order:

**Step 1 — Spike damage.** The defender's **spikes** strike the attacker first, absorbed by the attacker's **armor**; any excess spills into the attacker's **strength**.
- If the attacker's strength reaches 0, the attacker **dies to spikes** and is removed. The defender consumes spikes equal to the attacker's original armor + strength.
- If the attacker survives, the spikes that were used are **consumed** from the defender.

**Step 2 — Effective health check.** If the surviving attacker's strength is **greater than** the defender's total effective health (armor + strength + spikes), the defender is **captured outright** — the attacker takes the square. Note that the attacker's strength used here is the **spike-reduced value** from Step 1 — the attacker's strength was already reduced by however many spikes pierced its armor, and that reduced strength is what's compared against the defender's effective health.

**Step 3 — Armor breakthrough.** Otherwise, the attacker chips the defender's armor by its strength:
- If the defender's armor holds (armor − strength ≥ 0): armor is reduced, and the attacker **bounces back** off the square (2 paces back if it moved 2+, landing adjacent).
- If the attacker breaks through (armor < 0): the **leftover power** (attacker strength − defender armor) reduces the defender's strength.
  - If leftover power ≥ defender's strength, the defender is **captured**.
  - Otherwise the defender's strength is reduced and the attacker is **repelled** back.

**Spikes are consumed on every attack** — each combat exchange permanently burns the defender's spikes that were used. A defender's spikes are a finite, one-time layer of protection, not a renewable resource.

**Outcomes summary:** `Piece died to spikes` · `Piece captured` · `Piece repelled` · `Piece bounced off armor`.

### Worked combat examples

**Example A — Bounce off armor:** Attacker **5/5/0** attacks defender **3/7/3**.
1. Step 1: defender's 3 spikes hit attacker's armor 5 → armor **2**, strength stays **5**. Defender's spikes consumed → **0**.
2. Step 2: attacker strength 5 vs defender effective health 3 + 7 + 0 = 10 → 5 is not > 10.
3. Step 3: armor holds (7 − 5 = 2 ≥ 0) → defender armor **2**, attacker **bounces back**.

**Example B — Captured outright:** Attacker **6/4/0** attacks defender **2/3/0**.
1. Step 1: no spikes.
2. Step 2: attacker strength 6 vs defender effective health 2 + 3 = 5 → 6 > 5 → **captured outright**. Attacker takes the square.

**Example C — Repelled:** Attacker **4/1/0** attacks defender **5/2/0**.
1. Step 1: no spikes — the attacker's stats are untouched (spikes are the *only* thing that organically reduces the attacker's strength).
2. Step 2: 4 vs 5 + 2 = 7 → not > 7.
3. Step 3: armor breaks (2 − 4 = −2 < 0) → leftover power = 4 − 2 = **2**, which is less than defender strength 5 → defender strength reduced to **3**, attacker **repelled** back.
4. Result: defender is now **3/0/0**; the attacker returns to its starting square with its **full 4/1/0** intact.

**Example D — Dies to spikes:** Attacker **2/1/0** attacks defender **1/1/4**.
1. Step 1: defender's 4 spikes hit attacker's armor 1 → armor **0**, excess 3 spills into strength → strength **−1** → attacker **dies to spikes**.
2. Defender consumes spikes equal to the attacker's original armor + strength = 1 + 2 = **3** → defender left with **1 spike**.

**Example E — Spike-reduced capture:** Attacker **8/1/0** attacks defender **3/3/2**.
1. Step 1: defender's 2 spikes hit attacker's armor 1 → armor **0**, excess 1 spills into strength → strength **7**. Defender's spikes consumed → **0**.
2. Step 2: attacker strength **7** (not 8 — reduced by spikes) vs defender effective health 3 + 3 + 0 = 6 → 7 > 6 → **captured outright**. Had the attacker's full strength of 8 been used, the result is the same here — but against a defender with effective health 7, the spike-reduced 7 would *not* capture while the original 8 would.

## 9. Winning & Scoring

**Primary win condition:** Eliminate **all of the opponent's pieces** from the board (captured, or killed by spikes).

**Alternate win condition (stars):** Be the first to collect **10 stars**. A single star spawns every **10 turns** in the center of the board (only one star exists at a time). A star appears on a random empty square within the neutral zone (rows 4–10), weighted toward the four center hot-zone squares (`28,6` `29,6` `28,8` `29,8`) and the 7th row. A piece collects a star by **landing** on its square; stars do not block movement. Reaching 10 stars ends the game immediately with that player as the winner.

**Tiebreaker (points):** If the game determines that a kill or swap is **mathematically impossible** (e.g., remaining pieces on both sides cannot reach each other or cannot capture), points decide the winner.

Points = **total value of enemy pieces you captured** throughout the game.

Examples:
- You captured enemy 5, 3, and 2 = 10 points
- Opponent captured your 8 and 1 = 9 points
- **You win on points** (if elimination is impossible)

