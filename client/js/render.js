        // ============ Board Rendering ============
        const COLUMNS = [21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36];
        const ROWS = [1,2,3,4,5,6,7,8,9,10,11,12,13];

        // Display-only square names. Backend keeps authoritative "col,row"
        // (e.g. 21,1); frontend shows chess-style labels (21,1 -> a1).
        // col 21..36 -> file a..p, row stays 1..13.
        function displaySquare(col, row) {
            const c = Number(col);
            const r = Number(row);
            if (Number.isInteger(c) && Number.isInteger(r) && c >= 21 && c <= 36 && r >= 1 && r <= 13) {
                return `${String.fromCharCode(97 + (c - 21))}${r}`;
            }
            return `${col},${row}`;
        }

        // Replace every backend "col,row" coord in a history string with its
        // display label, so "21,1" renders as "a1" without touching backend data.
        function prettifyCoords(text) {
            return String(text).replace(/(\d{1,3}),(\d{1,3})/g, (m, c, r) => {
                const cn = Number(c);
                const rn = Number(r);
                if (cn >= 21 && cn <= 36 && rn >= 1 && rn <= 13) return displaySquare(cn, rn);
                return m;
            });
        }

        // Make backend history events read like a battle report, e.g.
        // "Blue 7 from 21,1 attacked Red 5 at 22,2: chipped 3 armor, bounced to 21,1"
        // -> "Blue piece 7 attacked Red piece 5 at b2 and chipped 3 armor, bounced back to a1".
        // Display-only: animations still parse the RAW event from state.
        function formatHistoryEvent(raw) {
            const s0 = String(raw);
            // Pass through non-combat system messages with just coord prettifying.
            if (/^game started/i.test(s0) || /wins!/i.test(s0) || /star/i.test(s0) || /^Max spikes/i.test(s0) || /^Spikes shed/i.test(s0) || /^Square bricked/i.test(s0) || /^Shards? /i.test(s0)) {
                return prettifyCoords(s0);
            }
            let s = prettifyCoords(s0);
            const norm = (t) => t.replace(/\bBlue piece (\d+)/g, 'Blue piece $1')
                .replace(/\bRed piece (\d+)/g, 'Red piece $1')
                .replace(/\bBlue (\d+)/g, 'Blue piece $1')
                .replace(/\bRed (\d+)/g, 'Red piece $1');
            s = norm(s);
            // died to spikes: "Blue piece 7 from a1 died to spikes attacking Red piece 5 at b2 (spikes 3 ate 2 armor + 1 strength)"
            let m = s.match(/^(Blue piece \d+|Red piece \d+) from (\S+) died to spikes attacking (Blue piece \d+|Red piece \d+) at (\S+)(.*)$/);
            if (m) return `${m[1]} charged from ${m[2]} into ${m[3]} at ${m[4]} and died on its spikes${m[5] ? ` ${m[5].trim()}` : ''}`;
            // capture: "Blue piece 7 from a1 captured Red piece 5 at b2 ..."
            m = s.match(/^(Blue piece \d+|Red piece \d+) from (\S+) captured (Blue piece \d+|Red piece \d+) at (\S+)(.*)$/);
            if (m) {
                const extra = m[5] ? ` ${m[5].trim()}` : '';
                return `${m[1]} attacked ${m[3]} at ${m[4]} from ${m[2]} and captured it${extra}`;
            }
            // repelled / bounced: "Blue piece 7 from a1 attacked Red piece 5 at b2: chipped ... , repelled/bounced to c3"
            m = s.match(/^(Blue piece \d+|Red piece \d+) from (\S+) attacked (Blue piece \d+|Red piece \d+) at (\S+):?\s*(.*?)\s*,?\s*(repelled|bounced)(?: back)? to (\S+)\s*$/);
            if (m) {
                const detail = m[5] ? ` and ${m[5].replace(/^chipped /, 'chipped ')}` : '';
                return `${m[1]} attacked ${m[3]} at ${m[4]}${detail}, ${m[6]} back to ${m[7]} block`;
            }
            // generic attack without bounce (shouldn't happen, but keep readable)
            m = s.match(/^(Blue piece \d+|Red piece \d+) from (\S+) attacked (Blue piece \d+|Red piece \d+) at (\S+)(.*)$/);
            if (m) return `${m[1]} attacked ${m[3]} at ${m[4]}${m[5] || ''}`;
            // move: "Blue piece 7 moved from a1 to b2"
            m = s.match(/^(Blue piece \d+|Red piece \d+) moved from (\S+) to (\S+)\s*$/);
            if (m) return `${m[1]} moved from ${m[2]} to ${m[3]} block`;
            // merge: "Blue piece 7 from a1 merged with Blue piece 5 at b2 (merged)"
            m = s.match(/^(Blue piece \d+|Red piece \d+) from (\S+) merged with (Blue piece \d+|Red piece \d+) at (\S+)(.*)$/);
            if (m) return `${m[1]} from ${m[2]} merged into ${m[3]} at ${m[4]} block${m[5] ? ` ${m[5].trim()}` : ''}`;
            // effects
            if (/^Effect used:/i.test(s)) return s;
            return s;
        }

        // Global tooltip: one fixed element following the hovered piece.
        // (Per-piece .tip divs would be clipped by .cell { overflow: hidden }.)
        function tooltipHTML(p, col, row) {
            const cap = spikeCap(p.strength);
            const moveKind = p.strength >= 5 ? 'Can move orthogonally' : 'Can move in any direction';
            const side = p.affiliation === 'blue' ? '🔵 Blue' : '🔴 Red';
            return `<div class="ttitle">${side} piece ${p.strength} · ${displaySquare(col, row)}</div>` +
                `<div class="trow"><span>⭐ Strength</span><span>${p.strength}</span></div>` +
                `<div class="trow"><span>🛡️ Armor</span><span>${p.armor}</span></div>` +
                `<div class="trow"><span>⚡ Spike</span><span>${p.spike}/${cap}</span></div>` +
                `<div class="trow"><span>📏 Range</span><span>${p.range}</span></div>` +
                `<div class="tnote">${moveKind}</div>`;
        }
        function showPieceTooltip(pieceEl, p, col, row) {
            const tip = document.getElementById('piece-tooltip');
            if (!tip) return;
            tip.innerHTML = tooltipHTML(p, col, row);
            tip.style.display = 'block';
            const r = pieceEl.getBoundingClientRect();
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            let x = r.left + (r.width / 2) - (tw / 2);
            let y = r.top - th - 8;
            if (y < 8) y = r.bottom + 8; // flip below near top edge
            x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
            tip.style.left = `${x}px`;
            tip.style.top = `${y}px`;
        }
        function hidePieceTooltip() {
            const tip = document.getElementById('piece-tooltip');
            if (tip) tip.style.display = 'none';
        }

        function renderGame(state) {
            if (!state) return;

            const grid = document.getElementById('board-grid');
            grid.innerHTML = '';

            // Outside coordinate headers (display only — backend keeps 21,1 coords).
            // Built once: columns A–P on top, rows 1–13 on the left.
            const colLabels = document.getElementById('col-labels');
            if (colLabels && !colLabels.children.length) {
                for (const col of COLUMNS) {
                    const h = document.createElement('div');
                    h.className = 'coord-head';
                    h.textContent = String.fromCharCode(65 + (col - 21));
                    colLabels.appendChild(h);
                }
            }
            const rowLabels = document.getElementById('row-labels');
            if (rowLabels && !rowLabels.children.length) {
                for (const row of ROWS) {
                    const h = document.createElement('div');
                    h.className = 'coord-head';
                    h.textContent = `${row}`;
                    rowLabels.appendChild(h);
                }
            }

            const isMyTurn = myAffiliation && state.turn === myAffiliation && !state.gameOver && !pendingIntent;

            // Turn badge lives inside the side panel (no full-width banner).
            const badge = document.getElementById('turn-badge');
            if (badge) {
                if (!myAffiliation) {
                    badge.className = 'theirs';
                    badge.textContent = 'Waiting...';
                } else if (state.gameOver) {
                    const winner = state.gameWinner === 'blue' ? '🔵 Blue' : '🔴 Red';
                    badge.className = 'done';
                    badge.textContent = `${winner} wins!`;
                } else if (isMyTurn) {
                    badge.className = 'mine';
                    const goEffect = state.turnEffect || 'Merge';
                    badge.textContent = `✓ Your turn — go! · Move or ${goEffect}`;
                } else {
                    badge.className = 'theirs';
                    badge.textContent = "⏳ Opponent's turn — wait...";
                }
            }



            for (const row of ROWS) {
                for (const col of COLUMNS) {
                    const cell = document.createElement('div');
                    const key = `${col},${row}`;
                    const square = state.board[key];

                    // Visual starting-row tint only. It has no gameplay effect;
                    // either affiliation may move onto any free square.
                    let zone = 'neutral';
                    if (row <= 3) zone = 'red';
                    else if (row >= 11) zone = 'blue';
                    cell.className = `cell zone-${zone}`;

                    if (square?.bricked) {
                        cell.classList.add('brick');
                    } else if (square?.shard) {
                        cell.classList.add(`shard-${square.shard}`);
                    } else if (square?.star) {
                        cell.classList.add('star');
                    }

                    // Piece rendering
                    if (square?.tenant) {
                        const p = square.tenant;
                        const pieceEl = document.createElement('div');
                        pieceEl.className = `piece ${p.affiliation}`;

                        // Check if this piece is selected
                        const isSelected = !!(selection && selection.col === col && selection.row === row);
                        if (isSelected) {
                            pieceEl.classList.add('selected');
                        }

                        // Highlight only targets the server can actually accept.
                        if (isMyTurn && armedEffect && canUseEffectOn(armedEffect, p) && !isSelected) {
                            pieceEl.classList.add('effect-target');
                            pieceEl.style.cursor = 'pointer';
                        }

                        // On Merge turns, mark ally pieces the selected piece can merge
                        // into with a yellow landing halo.
                        if (!isSelected && isMyTurn && selection && state.turnEffect === 'Merge'
                            && p.affiliation === myAffiliation
                            && selection.piece.affiliation === myAffiliation
                            && canMergeInto(selection.piece, [col, row])) {
                            pieceEl.classList.add('landing-target');
                            pieceEl.style.cursor = 'pointer';
                        }

                        // Mark enemy pieces the selected piece can legally attack
                        // (land on to capture) with a yellow halo. Capture is always
                        // allowed, even on Merge turns (merge only affects allies).
                        if (!isSelected && isMyTurn && selection
                            && p.affiliation !== myAffiliation
                            && selection.piece.affiliation === myAffiliation
                            && canCaptureOnto(selection.piece, [col, row])) {
                            pieceEl.classList.add('landing-target');
                            pieceEl.style.cursor = 'pointer';
                        }

                        // Piece content — slim tile: spike badge (if any) + big
                        // strength with small green range to its right + armor.
                        pieceEl.innerHTML = `
                            <div class="prow">${p.spike > 0 ? `<span class="spike">⚡${p.spike}</span>` : `<span></span>`}</div>
                            <div class="str"><span class="snum">${p.strength}</span><span class="rng">${p.range}</span></div>
                            <div class="armor">🛡️ ${p.armor}</div>
                        `;
                        // Hover tooltip with full stats (global fixed element).
                        // Skip the tooltip for the currently selected piece — its
                        // stats are already shown in the side panel.
                        if (!isSelected) {
                            pieceEl.addEventListener('mouseenter', () => showPieceTooltip(pieceEl, p, col, row));
                            pieceEl.addEventListener('mouseleave', hidePieceTooltip);
                        }

                        // Click handler
                        if (isMyTurn && p.affiliation === myAffiliation) {
                            pieceEl.style.cursor = 'pointer';
                            pieceEl.onclick = (e) => {
                                e.stopPropagation();
                                handlePieceClick(col, row, p);
                            };
                        } else if (isMyTurn && p.affiliation !== myAffiliation) {
                            // Enemy piece: click = capture attempt (when a piece is
                            // selected) OR an armed Weaken/Strengthen effect target.
                            pieceEl.style.cursor = 'pointer';
                            pieceEl.onclick = (e) => {
                                e.stopPropagation();
                                handleDestinationClick(col, row);
                            };
                        }

                        cell.appendChild(pieceEl);
                    } else if (isMyTurn && selection) {
                        // Empty tile = potential move destination.
                        // Only highlight if this square is a LEGAL move for the
                        // selected piece — correct rook (straight only) vs
                        // queen (straight + diagonal) movement, in range, and
                        // with a clear path.
                        const sel = selection;
                        if (canSelectMoveTo(sel.piece, [col, row])) {
                            cell.style.cursor = 'pointer';
                            cell.style.background = 'rgba(124, 58, 237, 0.15)';
                            cell.onclick = () => handleDestinationClick(col, row);
                        }
                    }

                    cell.dataset.col = col;
                    cell.dataset.row = row;
                    grid.appendChild(cell);
                }
            }

            // Update UI panels (counters live in the side panel match-stats).
            updateBanner(state);
            updateHistory(state);
            document.getElementById('turn-counter').textContent = `${state.turnCount}`;
            document.getElementById('brick-counter').textContent = `${state.bricks || 0}`;
            const myStarCount = myAffiliation === 'red' ? (state.redStars || 0) : (state.blueStars || 0);
            const enemyStarCount = myAffiliation === 'red' ? (state.blueStars || 0) : (state.redStars || 0);
            const starsToWin = state.starsToWin || 10;
            document.getElementById('star-counter').textContent = `${myStarCount} / ${enemyStarCount} (${starsToWin})`;
            document.getElementById('tips-box').querySelector('.tip-text').textContent = getTip(state.turnEffect);
            updateEffectButtons(state);
            renderEffectChip(state);
            renderCapsLegend();
        }

        // The server deliberately broadcasts only the authoritative end state.
        // Animate the visual transition locally so movement remains responsive
        // without making the server wait or allowing clients to mutate state.
        // Distance between two squares (Chebyshev — matches movement rules).
        function chebyshev(a, b) {
            return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
        }

        // Smooth, frame-by-frame (pixel-to-pixel) tween of `el` from its
        // current transform to a target transform, resolving when done.
        // Drives transform via requestAnimationFrame so the piece glides the
        // whole way instead of teleporting to the destination.
        function tweenTransform(el, fromX, fromY, toX, toY, duration) {
            return new Promise(resolve => {
                const start = performance.now();
                const tick = (now) => {
                    const t = Math.min((now - start) / duration, 1);
                    const x = fromX + (toX - fromX) * t;
                    const y = fromY + (toY - fromY) * t;
                    el.style.transform = `translate(${x}px, ${y}px)`;
                    if (t < 1) requestAnimationFrame(tick);
                    else resolve();
                };
                requestAnimationFrame(tick);
            });
        }

        function animatePieceTransition(previous, next) {
            if (!previous || !next) return Promise.resolve();
            const grid = document.getElementById('board-grid');
            const finalPieces = [];
            const oldPieces = [];
            const newBrickCells = [];
            const lastEvent = next.gameHistory?.[next.gameHistory.length - 1]?.event || '';
            const isBounceResult = lastEvent.includes('repelled') || lastEvent.includes('bounced');
            const isCaptureResult = lastEvent.includes(' captured ');
            for (const row of ROWS) for (const col of COLUMNS) {
                const oldPiece = previous.board[`${col},${row}`]?.tenant;
                const newPiece = next.board[`${col},${row}`]?.tenant;
                if (oldPiece) oldPieces.push({ piece: oldPiece, col, row });
                if (newPiece) finalPieces.push({ piece: newPiece, col, row });
                // Bricking is a post-move stage on the server. The end-state
                // render already contains the new brick, so hide it until the
                // move finishes; otherwise a legal move can appear to glide
                // through a wall that did not exist when the move was made.
                if (!previous.board[`${col},${row}`]?.bricked && next.board[`${col},${row}`]?.bricked) {
                    const cell = grid.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
                    if (cell) {
                        cell.classList.add('brick-arrival-hidden');
                        newBrickCells.push(cell);
                    }
                }
            }

            const movementPromises = [];

            for (const finalPiece of finalPieces) {
                // Bounce results have a dedicated collision animation. Do
                // not also play the ordinary source-to-final movement, or
                // the attacker appears to take two conflicting paths.
                if (isBounceResult || isCaptureResult) continue;
                const candidate = oldPieces
                    .filter(old => old.piece.affiliation === finalPiece.piece.affiliation
                        && (old.col !== finalPiece.col || old.row !== finalPiece.row)
                        // A merge leaves the destination occupied in both
                        // states, so also accept the ally piece whose
                        // original square became empty.
                        && (!next.board[`${old.col},${old.row}`]?.tenant
                            || next.board[`${old.col},${old.row}`].tenant.affiliation !== old.piece.affiliation)
                        // Do not steal a moving piece's animation for an
                        // unchanged piece elsewhere on the board.
                        // A same-affiliation tenant at the destination is a
                        // stat update (or merge), not a piece arriving there.
                        && (!previous.board[`${finalPiece.col},${finalPiece.row}`]?.tenant
                            || previous.board[`${finalPiece.col},${finalPiece.row}`].tenant.affiliation !== finalPiece.piece.affiliation
                            || pieceDifference(previous.board[`${finalPiece.col},${finalPiece.row}`].tenant, finalPiece.piece) > 0))
                    .sort((a, b) => pieceDifference(a.piece, finalPiece.piece) - pieceDifference(b.piece, finalPiece.piece))[0];
                if (!candidate) continue;

                const destinationCell = grid.querySelector(`.cell[data-col="${finalPiece.col}"][data-row="${finalPiece.row}"]`);
                const finalEl = destinationCell?.querySelector('.piece');
                if (!destinationCell || !finalEl) continue;

                const clone = finalEl.cloneNode(true);
                clone.classList.add('movement-clone');
                finalEl.classList.add('movement-arrival-hidden');
                // A shard is consumed in the authoritative state as soon as
                // the move is accepted, so the re-render above normally
                // removes it before the moving piece reaches the square.
                // Keep a visual copy on the destination for the duration of
                // the flight so the pickup reads as happening on arrival.
                const previousDestination = previous.board[`${finalPiece.col},${finalPiece.row}`];
                const nextDestination = next.board[`${finalPiece.col},${finalPiece.row}`];
                const pickedShard = previousDestination?.shard;
                const preserveShard = pickedShard && !nextDestination?.shard;
                if (preserveShard) destinationCell.classList.add(`shard-${pickedShard}`);
                clone.style.width = `${destinationCell.clientWidth}px`;
                clone.style.height = `${destinationCell.clientHeight}px`;
                clone.style.left = `${destinationCell.offsetLeft}px`;
                clone.style.top = `${destinationCell.offsetTop}px`;
                // The clone is physically placed at the destination cell, so
                // "at rest" it sits at translate(0,0). Start it translated
                // back to the source square, then glide it to (0,0) in one
                // continuous motion.
                clone.style.transition = 'none';
                const startX = (candidate.col - finalPiece.col) * (destinationCell.clientWidth + 2);
                const startY = (candidate.row - finalPiece.row) * (destinationCell.clientHeight + 2);
                clone.style.transform = `translate(${startX}px, ${startY}px)`;
                grid.appendChild(clone);

                // Longer moves get proportionally more time, but never so
                // fast that the glide blurs. Scale with distance.
                const distance = chebyshev(candidate, finalPiece);
                const duration = Math.min(Math.max(distance * 170, 180), 900);

                movementPromises.push(
                    tweenTransform(clone, startX, startY, 0, 0, duration).then(() => {
                        clone.remove();
                        finalEl.classList.remove('movement-arrival-hidden');
                        if (preserveShard) destinationCell.classList.remove(`shard-${pickedShard}`);
                    })
                );
            }

            const combatPromise = animateCombatSequence(previous, next, oldPieces);
            const statPromise = animateStatChanges(previous, next);

            return Promise.all([...movementPromises, combatPromise, statPromise]).finally(() => {
                newBrickCells.forEach(cell => cell.classList.remove('brick-arrival-hidden'));
            });
        }

        function pieceDifference(a, b) {
            return (a.strength !== b.strength ? 4 : 0)
                + (a.armor !== b.armor ? 2 : 0)
                + (a.spike !== b.spike ? 1 : 0)
                + (a.range !== b.range ? 1 : 0);
        }

        function movementPath(candidate, finalPiece) {
            const path = [];
            let col = candidate.col;
            let row = candidate.row;
            while (col !== finalPiece.col || row !== finalPiece.row) {
                col += Math.sign(finalPiece.col - col);
                row += Math.sign(finalPiece.row - row);
                path.push({ col, row });
            }
            return path;
        }

        function animateCombatSequence(previous, next, oldPieces) {
            const event = next.gameHistory?.[next.gameHistory.length - 1]?.event || '';
            if (event.includes('captured')) {
                // The server broadcasts the post-capture board immediately,
                // which removes the defender and leaves the attacker at the
                // destination. Do the whole visual attack here so neither
                // piece disappears before the attacker arrives.
                const fromMatch = event.match(/from (\d+),(\d+)/);
                const atMatch = event.match(/at (\d+),(\d+)/);
                if (!fromMatch || !atMatch) return Promise.resolve();
                const fromCol = Number(fromMatch[1]);
                const fromRow = Number(fromMatch[2]);
                const destCol = Number(atMatch[1]);
                const destRow = Number(atMatch[2]);
                const grid = document.getElementById('board-grid');
                const originCell = grid.querySelector(`.cell[data-col="${fromCol}"][data-row="${fromRow}"]`);
                const destCell = grid.querySelector(`.cell[data-col="${destCol}"][data-row="${destRow}"]`);
                const finalEl = destCell?.querySelector('.piece');
                const oldAttacker = previous.board[`${fromCol},${fromRow}`]?.tenant;
                const oldDefender = previous.board[`${destCol},${destRow}`]?.tenant;
                if (!originCell || !destCell || !finalEl || !oldAttacker || !oldDefender) return Promise.resolve();

                finalEl.classList.add('movement-arrival-hidden');
                const makeClone = (piece, cell) => {
                    const clone = document.createElement('div');
                    clone.className = `piece ${piece.affiliation} movement-clone`;
                    clone.innerHTML = `<div class="prow">${piece.spike > 0 ? `<span class="spike">⚡${piece.spike}</span>` : `<span></span>`}</div><div class="str"><span class="snum">${piece.strength}</span><span class="rng">${piece.range}</span></div><div class="armor">🛡️ ${piece.armor}</div>`;
                    clone.style.width = `${cell.clientWidth}px`;
                    clone.style.height = `${cell.clientHeight}px`;
                    clone.style.left = `${cell.offsetLeft}px`;
                    clone.style.top = `${cell.offsetTop}px`;
                    return clone;
                };
                const attackerClone = makeClone(oldAttacker, originCell);
                const defenderClone = makeClone(oldDefender, destCell);
                // Keep the moving attacker above the defender at contact,
                // matching the bounce animation. DOM insertion order used to
                // put the defender on top, making the attacker look buried.
                defenderClone.style.zIndex = '10';
                attackerClone.style.zIndex = '11';
                grid.appendChild(attackerClone);
                grid.appendChild(defenderClone);
                const stepW = originCell.clientWidth + 2;
                const stepH = originCell.clientHeight + 2;
                const distance = Math.max(Math.abs(destCol - fromCol), Math.abs(destRow - fromRow));
                const duration = Math.min(Math.max(distance * 170, 180), 900);
                const startX = 0;
                const startY = 0;
                const endX = (destCol - fromCol) * stepW;
                const endY = (destRow - fromRow) * stepH;
                attackerClone.style.transform = `translate(${startX}px, ${startY}px)`;
                defenderClone.style.transform = 'translate(0px, 0px)';

                return tweenTransform(attackerClone, startX, startY, endX, endY, duration).then(() => {
                    defenderClone.classList.add('combat-hit');
                    return new Promise(resolve => setTimeout(resolve, 420));
                }).then(() => {
                    attackerClone.remove();
                    defenderClone.remove();
                    finalEl.classList.remove('movement-arrival-hidden');
                });
            }
            // Attacker died on spikes: slide into the defender then fade out.
            // The authoritative state has no attacker left, so build the clone
            // from the previous state's piece data and origin geometry.
            if (event.includes('died to spikes')) {
                const from = event.match(/from (\d+),(\d+)/);
                const at = event.match(/at (\d+),(\d+)/);
                if (!from || !at) return Promise.resolve();
                const fromCol = Number(from[1]);
                const fromRow = Number(from[2]);
                const defCol = Number(at[1]);
                const defRow = Number(at[2]);
                const originCell = document.querySelector(`.cell[data-col="${fromCol}"][data-row="${fromRow}"]`);
                const defCell = document.querySelector(`.cell[data-col="${defCol}"][data-row="${defRow}"]`);
                const defEl = defCell?.querySelector('.piece');
                if (!originCell || !defCell) return Promise.resolve();
                if (defEl) defEl.classList.add('combat-hit');
                const oldAttacker = previous.board[`${fromCol},${fromRow}`]?.tenant;
                const moverAff = oldAttacker?.affiliation || (/^Red /.test(event) ? 'red' : 'blue');
                const clone = document.createElement('div');
                clone.className = `piece ${moverAff} movement-clone`;
                const str = oldAttacker?.strength ?? '?';
                const armor = oldAttacker?.armor ?? '?';
                const spike = oldAttacker?.spike ?? 0;
                const rng = oldAttacker?.range ?? '?';
                clone.innerHTML = `<div class="prow">${spike > 0 ? `<span class="spike">⚡${spike}</span>` : `<span></span>`}</div><div class="str"><span class="snum">${str}</span><span class="rng">${rng}</span></div><div class="armor">🛡️ ${armor}</div>`;
                clone.style.width = `${originCell.clientWidth}px`;
                clone.style.height = `${originCell.clientHeight}px`;
                clone.style.left = `${originCell.offsetLeft}px`;
                clone.style.top = `${originCell.offsetTop}px`;
                clone.style.transform = `translate(0px, 0px)`;
                document.getElementById('board-grid').appendChild(clone);
                const path = [];
                let col = fromCol;
                let row = fromRow;
                while (col !== defCol || row !== defRow) {
                    col += Math.sign(defCol - col);
                    row += Math.sign(defRow - row);
                    path.push({ col, row });
                }
                return new Promise(resolve => {
                    let index = 0;
                    const hop = () => {
                        if (index >= path.length) {
                            clone.style.transition = 'opacity 300ms';
                            clone.style.opacity = '0';
                            setTimeout(() => { clone.remove(); resolve(); }, 320);
                            return;
                        }
                        const point = path[index++];
                        clone.style.transform = `translate(${(point.col - fromCol) * (originCell.clientWidth + 2)}px, ${(point.row - fromRow) * (originCell.clientHeight + 2)}px)`;
                        setTimeout(hop, 190);
                    };
                    requestAnimationFrame(() => requestAnimationFrame(hop));
                });
            }
            if (!event.includes('repelled') && !event.includes('bounced')) return Promise.resolve();

            // Parse coordinates straight from the authoritative history event:
            // "... from <attackerStart> attacked ... at <defender> ... to <bounceFinal>"
            // This avoids fragile stat-matching (spike damage changes stats).
            const fromMatch = event.match(/from (\d+),(\d+)/);
            const atMatch = event.match(/at (\d+),(\d+)/);
            const toMatch = event.match(/to (\d+),(\d+)/);
            if (!fromMatch || !atMatch || !toMatch) return Promise.resolve();
            const fromCol = Number(fromMatch[1]);
            const fromRow = Number(fromMatch[2]);
            const defCol = Number(atMatch[1]);
            const defRow = Number(atMatch[2]);
            const finalCol = Number(toMatch[1]);
            const finalRow = Number(toMatch[2]);

            const grid = document.getElementById('board-grid');
            const originCell = grid.querySelector(`.cell[data-col="${fromCol}"][data-row="${fromRow}"]`);
            const defCell = grid.querySelector(`.cell[data-col="${defCol}"][data-row="${defRow}"]`);
            const finalCell = grid.querySelector(`.cell[data-col="${finalCol}"][data-row="${finalRow}"]`);
            if (!originCell || !defCell || !finalCell) return Promise.resolve();
            const defEl = defCell?.querySelector('.piece');

            // The board already re-rendered to the final state, so the origin
            // square is empty — fly a clone built from the PRE-combat attacker
            // stats, starting at the attacker's origin square. Built fresh (not
            // cloneNode from the hidden arrival element) so it can never
            // inherit `movement-arrival-hidden` and render invisible.
            const finalEl = finalCell.querySelector('.piece');
            if (!finalEl) return Promise.resolve();
            finalEl.classList.add('movement-arrival-hidden');
            const oldAttacker = previous.board[`${fromCol},${fromRow}`]?.tenant;
            const newAttacker = next.board[`${finalCol},${finalRow}`]?.tenant;
            const oldDef = previous.board[`${defCol},${defRow}`]?.tenant;
            const newDef = next.board[`${defCol},${defRow}`]?.tenant;
            const moverAff = (oldAttacker || newAttacker)?.affiliation
                || (finalEl.classList.contains('red') ? 'red' : 'blue');
            const flight = oldAttacker || newAttacker || { strength: '?', armor: '?', spike: 0, range: '?' };
            // Rewind the defender tile to pre-chip numbers so the reduction
            // visibly happens on impact, not before the attacker arrives.
            if (defEl && oldDef && newDef) {
                const str = defEl.querySelector('.str .snum') || defEl.querySelector('.str');
                const rng = defEl.querySelector('.str .rng');
                const armor = defEl.querySelector('.armor');
                const spike = defEl.querySelector('.spike');
                if (str) str.textContent = oldDef.strength;
                if (rng) rng.textContent = oldDef.range;
                if (armor) armor.textContent = `🛡️ ${oldDef.armor}`;
                if (spike) spike.textContent = oldDef.spike > 0 ? `⚡${oldDef.spike}` : '';
            }
            const clone = document.createElement('div');
            clone.className = `piece ${moverAff} movement-clone`;
            clone.innerHTML = `<div class="prow">${flight.spike > 0 ? `<span class="spike">⚡${flight.spike}</span>` : `<span></span>`}</div><div class="str"><span class="snum">${flight.strength}</span><span class="rng">${flight.range}</span></div><div class="armor">🛡️ ${flight.armor}</div>`;
            clone.style.width = `${originCell.clientWidth}px`;
            clone.style.height = `${originCell.clientHeight}px`;
            clone.style.left = `${originCell.offsetLeft}px`;
            clone.style.top = `${originCell.offsetTop}px`;
            clone.style.transform = `translate(0px, 0px)`;
            grid.appendChild(clone);

            // Waypoints: origin -> defender square (touch) -> bounce-back square.
            // Same 190ms per-square pace as a normal move so eyes can follow.
            const stepW = originCell.clientWidth + 2;
            const stepH = originCell.clientHeight + 2;
            const placeAt = (col, row) => {
                clone.style.transform = `translate(${(col - fromCol) * stepW}px, ${(row - fromRow) * stepH}px)`;
            };
            const steppedPath = (fc, fr, tc, tr) => {
                const pts = [];
                let c = fc, r = fr;
                while (c !== tc || r !== tr) {
                    c += Math.sign(tc - c);
                    r += Math.sign(tr - r);
                    pts.push({ col: c, row: r });
                }
                return pts;
            };
            const outbound = steppedPath(fromCol, fromRow, defCol, defRow);
            const inbound = steppedPath(defCol, defRow, finalCol, finalRow);

            return new Promise(resolve => {
                let outIdx = 0;
                const hopOut = () => {
                    if (outIdx >= outbound.length) {
                        // Contact: flash + chip the defender, dwell so the hit
                        // reads, then bounce back.
                        if (defEl) defEl.classList.add('combat-hit');
                        if (defEl && oldDef && newDef) {
                            const values = { strength: oldDef.strength, armor: oldDef.armor, spike: oldDef.spike, range: oldDef.range };
                            const tick = () => {
                                let pending = false;
                                for (const k of Object.keys(values)) {
                                    if (values[k] === newDef[k]) continue;
                                    values[k] += Math.sign(newDef[k] - values[k]);
                                    pending = true;
                                }
                                const s = defEl.querySelector('.str .snum') || defEl.querySelector('.str');
                                const r = defEl.querySelector('.str .rng');
                                const a = defEl.querySelector('.armor');
                                const sp = defEl.querySelector('.spike');
                                if (s) s.textContent = values.strength;
                                if (r) r.textContent = values.range;
                                if (a) a.textContent = `🛡️ ${values.armor}`;
                                if (sp) sp.textContent = values.spike > 0 ? `⚡${values.spike}` : '';
                                if (pending) setTimeout(tick, 180);
                            };
                            setTimeout(tick, 60);
                        }
                        setTimeout(hopBack, 420);
                        return;
                    }
                    const point = outbound[outIdx++];
                    placeAt(point.col, point.row);
                    setTimeout(hopOut, 190);
                };
                let backIdx = 0;
                const hopBack = () => {
                    if (backIdx >= inbound.length) {
                        clone.remove();
                        finalEl.classList.remove('movement-arrival-hidden');
                        resolve();
                        return;
                    }
                    const point = inbound[backIdx++];
                    placeAt(point.col, point.row);
                    setTimeout(hopBack, 190);
                };
                requestAnimationFrame(() => requestAnimationFrame(hopOut));
            });
        }

        // Keep the authoritative final piece rendered while briefly showing
        // each combat stat changing one point at a time. This makes armor and
        // strength damage readable instead of looking like a single blink.
        // Bounce/chip squares are skipped here — the bounce sequence above
        // owns their timing so the chip lands exactly on contact.
        function animateStatChanges(previous, next) {
            const lastEvent = next.gameHistory?.[next.gameHistory.length - 1]?.event || '';
            const skip = new Set();
            if (lastEvent.includes('repelled') || lastEvent.includes('bounced')) {
                const atMatch = lastEvent.match(/at (\d+),(\d+)/);
                const toMatch = lastEvent.match(/to (\d+),(\d+)/);
                if (atMatch) skip.add(`${atMatch[1]},${atMatch[2]}`);
                if (toMatch) skip.add(`${toMatch[1]},${toMatch[2]}`);
            }
            const jobs = [];
            for (const row of ROWS) for (const col of COLUMNS) {
                if (skip.has(`${col},${row}`)) continue;
                const oldPiece = previous.board[`${col},${row}`]?.tenant;
                const newPiece = next.board[`${col},${row}`]?.tenant;
                if (!oldPiece || !newPiece || oldPiece.affiliation !== newPiece.affiliation) continue;
                const changed = ['strength', 'armor', 'spike', 'range']
                    .some(stat => oldPiece[stat] !== newPiece[stat]);
                if (!changed) continue;

                const cell = document.querySelector(`.cell[data-col="${col}"][data-row="${row}"]`);
                const pieceEl = cell?.querySelector('.piece');
                if (!pieceEl) continue;
                pieceEl.classList.add('combat-hit');

                const values = {
                    strength: oldPiece.strength,
                    armor: oldPiece.armor,
                    spike: oldPiece.spike,
                    range: oldPiece.range,
                };
                jobs.push(new Promise(resolve => {
                    const step = () => {
                        let pending = false;
                        for (const stat of Object.keys(values)) {
                            if (values[stat] === newPiece[stat]) continue;
                            values[stat] += Math.sign(newPiece[stat] - values[stat]);
                            pending = true;
                        }
                        const str = pieceEl.querySelector('.str .snum') || pieceEl.querySelector('.str');
                        const rng = pieceEl.querySelector('.str .rng');
                        const armor = pieceEl.querySelector('.armor');
                        const spike = pieceEl.querySelector('.spike');
                        if (str) str.textContent = values.strength;
                        if (rng) rng.textContent = values.range;
                        if (armor) armor.textContent = `🛡️${values.armor}`;
                        if (spike) spike.textContent = values.spike > 0 ? `⚡${values.spike}` : '';
                        if (pending) setTimeout(step, 180);
                        else resolve();
                    };
                    // The first step is delayed so the hit and collision are
                    // visible before the numbers begin ticking down.
                    setTimeout(step, 220);
                }));
            }
            return Promise.all(jobs);
        }
