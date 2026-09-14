        // ============ Toast ============
        let toastTimer = null;
        function showToast(msg) {
            const el = document.getElementById('toast');
            el.textContent = msg;
            el.classList.add('show');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
        }

        // The room number is also a copy button so players can quickly share
        // it without having to select the text manually.
        async function copyRoomId() {
            const roomEl = document.getElementById('room-id-display');
            const code = roomEl?.textContent?.trim();
            if (!code || code === '—') return;
            try {
                await navigator.clipboard.writeText(code);
            } catch (e) {
                const input = document.createElement('textarea');
                input.value = code;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            showToast(`Room number ${code} copied!`);
        }

        function setOpponentStatus(text, kind) {
            document.getElementById('opponent-status').textContent = text;
            const icon = document.getElementById('opponent-status-icon');
            if (!icon) return;
            if (kind === 'bot') icon.textContent = '🤖';
            else if (kind === 'connected') icon.textContent = '✅';
            else if (kind === 'disconnected') icon.textContent = '⚠';
            else icon.textContent = '⏳';
        }

        // Tell the player which side they are on when they enter a game.
        // Single place so create + join + rejoin all announce consistently.
        function announceSide() {
            if (!myAffiliation) return;
            const label = myAffiliation === 'blue' ? '🔵 You are Blue side!' : '🔴 You are Red side!';
            showToast(label);
        }


        function showLanding(show) {
            document.getElementById('landing').style.display = show ? 'flex' : 'none';
            const glows = document.getElementById('landing-glows');
            if (glows) glows.style.display = show ? 'block' : 'none';
            const main = document.getElementById('main-container');
            main.style.display = show ? 'none' : 'flex';
            // Lock page scroll while playing so the whole board fits at 100% zoom.
            document.body.classList.toggle('game-active', !show);
        }

        // ============ Rules modal (beginner guide) ============
        function openRules() {
            const m = document.getElementById('rules-modal');
            m.classList.remove('hidden');
            m.classList.add('flex');
        }
        function closeRules() {
            const m = document.getElementById('rules-modal');
            m.classList.add('hidden');
            m.classList.remove('flex');
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { closeRules(); closeHistory(); }
        });

        function updateEffectButtons(state) {
            const s = state || gameState;
            const chip = document.getElementById('effect-chip');
            const hint = document.getElementById('effect-arm-hint');
            if (!s || !chip) return;
            const usable = !s.gameOver && myAffiliation === s.turn && s.turnEffect !== 'Merge'
                && !pendingIntent && pendingAnimations === 0;
            const key = (s.turnEffect || '').toLowerCase();
            const isArmed = usable && armedEffect === key;
            chip.classList.toggle('armed', isArmed);
            chip.disabled = !usable;
            if (hint) {
                if (!usable) hint.textContent = '';
                else if (isArmed) hint.textContent = '👆 Armed — tap a piece on the board';
                else hint.textContent = '👆 Tap to arm, then tap a piece';
            }
        }

        // ============ Stats Card ============
        // Hidden when nothing is selected; appears/expands when a piece is clicked.
        function updateStatsCard() {
            const card = document.getElementById('selected-card');
            const stats = document.getElementById('piece-stats');
            if (!card || !stats) return;

            if (!selection) {
                card.style.display = 'none';
                return;
            }

            card.style.display = 'block';
            card.classList.remove('card-pop');
            void card.offsetWidth; // restart the pop animation
            card.classList.add('card-pop');

            const p = selection.piece;
            const spikeCapValue = spikeCap(p.strength);

            stats.innerHTML = `
                <div class="stat-row"><span class="label">⭐ Strength</span><span class="value">${p.strength}</span></div>
                <div class="stat-row"><span class="label">🛡️ Armor</span><span class="value">${p.armor}</span></div>
                <div class="stat-row"><span class="label">⚡ Spike</span><span class="value">${p.spike} (cap ${spikeCapValue})</span></div>
                <div class="stat-row"><span class="label">📏 Range</span><span class="value">${p.range}</span></div>
            `;
        }

        // ============ Effect chip + arrival toast ============

        // Populate the side-panel chip and, when a NEW turn's effect arrives
        // (turn advanced since last render), fire a toast + pop animation so
        // the player is told exactly what tool is now available.
        function renderEffectChip(state) {
            const chip = document.getElementById('effect-chip');
            const chipTip = document.getElementById('effect-chip-tip');
            const box = document.getElementById('active-ability-box');
            if (!chip) return;

            const meta = EFFECT_META[state.turnEffect] || { icon: '✨', label: state.turnEffect, tip: '' };
            const color = EFFECT_COLORS[state.turnEffect] || EFFECT_COLORS.Merge;
            chip.textContent = `${meta.icon} ${meta.label}`;
            chip.style.background = color.bg;
            chip.style.color = color.fg;
            if (chipTip) chipTip.textContent = meta.tip;
            // Keep armed styling + hint in sync whenever the chip re-renders.
            updateEffectButtons(state);

            // Detect a fresh turn: turnCount advanced since the last render.
            const newTurn = lastTurnCount !== null && state.turnCount !== lastTurnCount;
            lastTurnCount = state.turnCount;

            // Only announce the effect when it's MY turn — the opponent's
            // effect is their business, not a tool I can use right now.
            if (newTurn && !state.gameOver && state.turn === myAffiliation) {
                // Pop the ability box + toast the effect so it can't be missed.
                if (box) {
                    box.classList.remove('effect-pop');
                    void box.offsetWidth; // restart the animation
                    box.classList.add('effect-pop');
                    spawnSparkles(box, color.fg);
                }
                showToast(`${color.toast} ${meta.label} turn — ${meta.tip}`);
            }
        }

        // Scatter a few twinkling sparkles across the ability box when my
        // effect arrives — a little celebratory shimmer on top of the pop.
        function spawnSparkles(box, color) {
            const n = 7;
            for (let i = 0; i < n; i++) {
                const sp = document.createElement('span');
                sp.className = 'sparkle';
                sp.textContent = '✨';
                sp.style.left = `${8 + Math.random() * 84}%`;
                sp.style.top = `${10 + Math.random() * 70}%`;
                sp.style.color = color;
                sp.style.animationDelay = `${Math.random() * 0.35}s`;
                sp.style.fontSize = `${0.55 + Math.random() * 0.6}rem`;
                box.appendChild(sp);
                // Remove after the animation completes so they don't pile up.
                setTimeout(() => sp.remove(), 1600);
            }
        }

        // Render the spike-cap legend (strength 1..8 → cap) so players learn
        // which pieces can hoard spikes without being surprised by clamping.
        function renderCapsLegend() {
            const legend = document.getElementById('caps-legend');
            if (!legend || legend.children.length) return; // build once
            for (let s = 1; s <= 8; s++) {
                const tile = document.createElement('div');
                tile.className = 'cap-tile';
                tile.title = `Strength ${s} holds max ${spikeCap(s)} spikes`;
                tile.innerHTML = `<span class="cl">Str</span><span class="cs">${s}</span><span class="cc">${spikeCap(s)}⚡</span>`;
                legend.appendChild(tile);
            }
        }

        // ============ Turn Banner ============
        // NOTE: the game-over overlay is NOT shown from here. It is triggered
        // from the gameState handler AFTER the winning move finishes animating,
        // so the user sees the final move land before the win/lose screen.
        function updateBanner(state) {
            const banner = document.getElementById('turn-banner');
            const turnText = document.getElementById('turn-text');

            if (state.gameOver) {
                const winnerName = state.gameWinner === 'blue' ? 'Blue' : 'Red';
                turnText.textContent = `${winnerName} wins!`;
                const winIcon = document.getElementById('turn-icon');
                if (winIcon) {
                    const isBlueWin = state.gameWinner === 'blue';
                    winIcon.textContent = isBlueWin ? '🔵' : '🔴';
                    winIcon.className = isBlueWin
                        ? 'w-10 h-10 rounded-2xl bg-gradient-to-b from-candy-sky to-candy-deepSky flex items-center justify-center shadow-pop-blue text-white text-lg'
                        : 'w-10 h-10 rounded-2xl bg-gradient-to-b from-candy-coral to-candy-deepPink flex items-center justify-center shadow-pop-pink text-white text-lg';
                }
                banner.className = 'turn-banner gameover';
                return;
            }

            const turnName = state.turn === 'blue' ? "Blue's turn" : "Red's turn";
            turnText.textContent = turnName;
            const turnIcon = document.getElementById('turn-icon');
            if (turnIcon) {
                const isBlue = state.turn === 'blue';
                turnIcon.textContent = isBlue ? '🔵' : '🔴';
                turnIcon.className = isBlue
                    ? 'w-10 h-10 rounded-2xl bg-gradient-to-b from-candy-sky to-candy-deepSky flex items-center justify-center shadow-pop-blue text-white text-lg'
                    : 'w-10 h-10 rounded-2xl bg-gradient-to-b from-candy-coral to-candy-deepPink flex items-center justify-center shadow-pop-pink text-white text-lg';
            }
            banner.className = `turn-banner ${state.turn}`;

            // Hide any leftover result overlay (e.g. after a rematch).
            document.getElementById('game-over-overlay').className = '';
        }

        // Full-screen dim overlay announcing the result. Win = big bold yellow
        // letters with stars; Lose = big bold blue letters.
        function showGameOverOverlay(state) {
            const overlay = document.getElementById('game-over-overlay');
            const title = document.getElementById('game-over-title');
            const flair = document.getElementById('game-over-flair');
            const subtitle = document.getElementById('game-over-subtitle');

            const iWon = state.gameWinner === myAffiliation;
            overlay.className = iWon ? 'win show' : 'lose show';

            if (iWon) {
                title.textContent = 'You Win!';
                flair.textContent = '✨⭐🌟✨';
                subtitle.textContent = `Victory — ${state.gameWinner === 'blue' ? '🔵 Blue' : '🔴 Red'} takes the board!`;
            } else {
                title.textContent = 'You Lose';
                flair.textContent = '💧💙💧';
                subtitle.textContent = `${state.gameWinner === 'blue' ? '🔵 Blue' : '🔴 Red'} wins this match.`;
            }
        }

        // ============ Rematch / Home ============
        // Rematch restarts a finished game with the same players/seats.
        function requestRematch() {
            if (!roomId) { showToast('No room to rematch'); return; }
            if (gameState && !gameState.gameOver) { showToast('Game is still in progress'); return; }
            if (socket && socket.connected) socket.emit('rematch', { roomId });
            else if (socket) socket.once('connect', () => socket.emit('rematch', { roomId }));
            showToast('Starting rematch...');
        }
        // Home returns to the landing page (keeps the socket for a fast rematch later).
        function goHome() {
            document.getElementById('game-over-overlay').className = '';
            try { window.history.pushState({}, '', '/'); } catch (e) { /* ignore */ }
            roomId = null;
            pendingJoin = null;
            clearActiveRoom();
            if (rejoinTimer) { clearTimeout(rejoinTimer); rejoinTimer = null; }
            gameState = null;
            selection = null;
            armedEffect = null;
            lastTurnEffect = null;
            lastTurnCount = null;
            // Reset header/panel chrome so the next game starts clean.
            document.getElementById('room-id-display').textContent = '—';
            document.getElementById('mode-badge').textContent = 'lobby';
            document.getElementById('copy-link').style.display = 'none';
            setOpponentStatus('Waiting for opponent...', 'waiting');
            document.getElementById('history-feed').innerHTML = '';
            document.getElementById('history-count').textContent = '0';
            showLanding(true);
        }
        // Quit mid-game: tell the server we're leaving (so the opponent is
        // notified immediately) then return to the landing page.
        function quitGame() {
            // Confirm only while a game is actually in progress — no need to
            // nag on a finished board or while still waiting in lobby.
            if (gameState && !gameState.gameOver) {
                if (!window.confirm('Quit this game and return home?')) return;
            }
            if (roomId && socket && socket.connected) {
                try { socket.emit('leaveRoom', { roomId }); } catch (e) { /* ignore */ }
            }
            goHome();
        }

        // ============ History Feed ============

        function updateHistory(state) {
            const feed = document.getElementById('history-feed');
            feed.innerHTML = '';
            if (!state.gameHistory) return;
            const total = state.gameHistory.length;
            const countEl = document.getElementById('history-count');
            if (countEl) countEl.textContent = `${total}`;
            // Show last 15 entries, newest first. Backend events keep raw
            // "col,row" coords (authoritative); we render display labels + a
            // descriptive battle-report phrasing here only.
            const entries = state.gameHistory.slice(-15).reverse();
            for (const entry of entries) {
                const div = document.createElement('div');
                div.className = `entry ${entry.player || ''}`;
                div.innerHTML = `<span class="turn-num">T${entry.turn}</span><span>${formatHistoryEvent(entry.event)}</span>`;
                feed.appendChild(div);
            }
            // Keep the explorer in sync if it is open.
            const modal = document.getElementById('history-modal');
            if (modal && !modal.classList.contains('hidden')) renderFullHistory();
        }
        function openHistory() {
            const m = document.getElementById('history-modal');
            m.classList.remove('hidden');
            m.classList.add('flex');
            renderFullHistory();
        }
        function closeHistory() {
            const m = document.getElementById('history-modal');
            if (!m) return;
            m.classList.add('hidden');
            m.classList.remove('flex');
        }
        function setHistoryFilter(f) {
            historyFilter = f;
            document.querySelectorAll('.history-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
            renderFullHistory();
        }
        function setHistorySearch(v) {
            historySearch = (v || '').toLowerCase();
            renderFullHistory();
        }
        function renderFullHistory() {
            const list = document.getElementById('history-full-list');
            if (!list || !gameState?.gameHistory) return;
            list.innerHTML = '';
            const total = gameState.gameHistory.length;
            const titleCount = document.getElementById('history-modal-count');
            if (titleCount) titleCount.textContent = `${total} move${total === 1 ? '' : 's'}`;
            // Newest first so the latest action is on top; every entry keeps
            // its turn number so chronological order is still visible.
            const entries = gameState.gameHistory.slice().reverse();
            let shown = 0;
            for (const entry of entries) {
                if (historyFilter !== 'all' && entry.player !== historyFilter) continue;
                const text = formatHistoryEvent(entry.event);
                if (historySearch && !(`t${entry.turn} ${entry.player || ''} ${text}`.toLowerCase().includes(historySearch))) continue;
                const div = document.createElement('div');
                div.className = `entry ${entry.player || ''}`;
                div.innerHTML = `<span class="turn-num">T${entry.turn}</span><span>${text}</span>`;
                list.appendChild(div);
                shown++;
            }
            if (shown === 0) {
                list.innerHTML = '<div class="text-center text-xs font-bold text-slate-400 py-6">No moves match this filter.</div>';
            }
        }
