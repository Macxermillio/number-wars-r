        // ============ Socket Connection ============
        // Tracks the room we are (re)joining so reconnects after a backend
        // restart can re-emit joinRoom automatically — the user never has to
        // quit and re-enter the room code by hand.

        function buildJoinPayload(code) {
            const seat = loadSeat(code);
            const payload = { roomId: code };
            if (seat && seat.playerId) payload.playerId = seat.playerId;
            else if (myPlayerId) payload.playerId = myPlayerId;
            return payload;
        }
        function emitJoin(code) {
            if (!socket) return;
            const payload = buildJoinPayload(code);
            if (socket.connected) socket.emit('joinRoom', payload);
            else socket.once('connect', () => socket.emit('joinRoom', payload));
        }
        function setRoomUrl(code) {
            if (!code) return;
            saveActiveRoom(code);
            // /play/:roomId is supported by both Vercel and the Railway
            // server. Keep the room in the address bar so a deployment or
            // refresh cannot send the player back to the lobby.
            try { window.history.replaceState({}, '', `/play/${code}`); } catch (e) { /* ignore */ }
        }
        function scheduleRejoin() {
            if (rejoinTimer) clearTimeout(rejoinTimer);
            if (!pendingJoin || !pendingJoin.roomId) return;
            // Retry joinRoom a few times: right after a deploy the room may
            // still be loading from Redis on the fresh backend.
            let attempts = 0;
            const tick = () => {
                if (!pendingJoin || !pendingJoin.roomId) return;
                // Stop only after the server has explicitly accepted this
                // socket. A gameState can be left over from before a deploy,
                // so it is not proof that this socket is in the room.
                if (joinedRoomId === pendingJoin.roomId) return;
                if (attempts >= 6) {
                    showToast('Still reconnecting… re-enter room code if this persists');
                    return;
                }
                attempts += 1;
                emitJoin(pendingJoin.roomId);
                rejoinTimer = setTimeout(tick, 1500);
            };
            rejoinTimer = setTimeout(tick, 800);
        }
        function connectSocket(pendingRoomId) {
            // Reuse an existing socket even while it is still connecting.
            // Creating another one here duplicates every registered handler.
            if (socket) {
                if (!socket.connected && !socket.active) socket.connect();
                return socket;
            }
            // The Socket.IO client lib may still be loading (CDN slow/blocked)
            // or may have failed entirely — never throw "io is not defined".
            if (typeof io === 'undefined') {
                showToast('Connecting to game server… (loading connection library)');
                // Retry once the backend-served fallback copy finishes loading.
                if (!connectSocket._retrying) {
                    connectSocket._retrying = true;
                    if (typeof loadBackendSocketIo === 'function') loadBackendSocketIo();
                    var tries = 0;
                    var wait = setInterval(function () {
                        tries += 1;
                        if (typeof io !== 'undefined') {
                            clearInterval(wait);
                            connectSocket._retrying = false;
                            connectSocket(pendingRoomId);
                            // Replay the pending action now that io exists.
                            if (pendingJoin && pendingJoin.roomId) emitJoin(pendingJoin.roomId);
                        } else if (tries >= 50) { // ~10s
                            clearInterval(wait);
                            connectSocket._retrying = false;
                            showToast('Could not reach the game server. Check your connection and reload.');
                        }
                    }, 200);
                }
                return null;
            }
            const stored = pendingRoomId ? loadSeat(pendingRoomId) : null;
            if (stored && stored.playerId) {
                // The seat for THIS room wins over any id from another room.
                myPlayerId = stored.playerId;
                if (stored.affiliation) myAffiliation = stored.affiliation;
            }
            socket = io(BACKEND_URL, {
                transports: ['websocket', 'polling'],
                auth: myPlayerId ? { playerId: myPlayerId } : {},
            });

            socket.on('connect', () => {
                console.log('[WS] Connected:', socket.id);
                // Backend restarted mid-game: the new process knows the room
                // (Redis) but not our socket — rejoin automatically.
                joinedRoomId = null;
                if (pendingJoin && pendingJoin.roomId) {
                    emitJoin(pendingJoin.roomId);
                    scheduleRejoin();
                }
            });

            socket.on('roomCreated', (data) => {
                showLanding(false);
                roomId = data.roomId;
                setRoomUrl(roomId);
                joinedRoomId = roomId;
                pendingJoin = { roomId, playerId: data.playerId || myPlayerId };
                if (rejoinTimer) { clearTimeout(rejoinTimer); rejoinTimer = null; }
                gameMode = data.mode || 'friend';
                myAffiliation = data.affiliation || 'blue';
                myPlayerId = data.playerId || myPlayerId;
                saveSeat(roomId, myPlayerId, myAffiliation);
                document.getElementById('room-id-display').textContent = `${roomId}`;
                document.getElementById('mode-badge').textContent = gameMode;
                announceSide();

                if (gameMode === 'friend') {
                    document.getElementById('copy-link').style.display = 'inline-block';
                    document.getElementById('copy-link').onclick = () => {
                        const link = `${window.location.origin}/${roomId}`;
                        navigator.clipboard.writeText(link);
                        showToast('Link copied!');
                    };
                }

                if (gameMode === 'computer' && data.difficulty) {
                    setOpponentStatus('Playing vs Computer (' + data.difficulty + ')', 'bot');
                } else if (gameMode === 'ai') {
                    setOpponentStatus('Playing vs AI', 'bot');
                } else if (gameMode === 'computer') {
                    setOpponentStatus('Playing vs Computer', 'bot');
                } else {
                    setOpponentStatus('Waiting for opponent...', 'waiting');
                }
            });

            socket.on('roomJoined', (data) => {
                showLanding(false);
                roomId = data.roomId;
                setRoomUrl(roomId);
                joinedRoomId = roomId;
                pendingJoin = { roomId, playerId: data.playerId || myPlayerId };
                if (rejoinTimer) { clearTimeout(rejoinTimer); rejoinTimer = null; }
                gameMode = data.mode;
                myAffiliation = data.affiliation;
                myPlayerId = data.playerId || myPlayerId;
                saveSeat(roomId, myPlayerId, myAffiliation);
                document.getElementById('room-id-display').textContent = `${roomId}`;
                document.getElementById('mode-badge').textContent = gameMode;
                announceSide();
                setOpponentStatus('Connected', 'connected');
                document.getElementById('copy-link').style.display = 'none';

                // If AI mode, opponent is already there
                if (gameMode === 'ai' || gameMode === 'computer') {
                    setOpponentStatus('Playing vs ' + (gameMode === 'ai' ? 'AI' : 'Computer'), 'bot');
                }
            });

            socket.on('gameState', (state) => {
                const previousState = gameState;
                gameState = state;
                pendingIntent = false;
                pendingAnimations += 1;
                refreshBoardInputLock();

                // Queue the render + animation so an opponent's instant reply
                // waits for the current move to finish animating first.
                enqueueAnimation(() => new Promise(resolve => {
                    renderGame(state);
                    const done = animatePieceTransition(previousState, state);
                    Promise.resolve(done).catch(() => {
                        // A visual failure must never strand the input lock.
                    }).then(() => {
                        // The winning move has now finished animating — only
                        // now show the overlay so the final move lands first.
                        if (state.gameOver) showGameOverOverlay(state);
                        resolve();
                    });
                })).finally(() => {
                    pendingAnimations = Math.max(0, pendingAnimations - 1);
                    refreshBoardInputLock();
                });

                // Clear selection on new state (piece may have moved)
                selection = null;
                armedEffect = null;
                updateStatsCard();
                updateEffectButtons();

                // Safety net: bot opponents are always present. If the label
                // is still stuck on "Waiting" (e.g. event race), lift it now.
                if (gameMode === 'ai' || gameMode === 'computer') {
                    const el = document.getElementById('opponent-status');
                    if (el && el.textContent.includes('Waiting')) {
                        setOpponentStatus('Playing vs ' + (gameMode === 'ai' ? 'AI' : 'Computer'), 'bot');
                    }
                }
            });

            socket.on('opponentJoined', () => {
                // Bot opponents are always present — never overwrite their label.
                if (gameMode === 'ai' || gameMode === 'computer') return;
                // Red is the joiner — only blue (host) should see this notice.
                if (myAffiliation === 'red') return;
                setOpponentStatus('Opponent connected', 'connected');
                if (gameMode === 'friend') {
                    document.getElementById('copy-link').style.display = 'none';
                }
            });

            socket.on('opponentReconnected', () => {
                // Bot opponents never disconnect — keep the bot label.
                if (gameMode === 'ai' || gameMode === 'computer') return;
                setOpponentStatus('Opponent connected', 'connected');
                showToast('Opponent reconnected');
                if (gameMode === 'friend') {
                    document.getElementById('copy-link').style.display = 'none';
                }
            });

            socket.on('playerDisconnected', () => {
                if (gameMode === 'ai' || gameMode === 'computer') return;
                setOpponentStatus('Opponent disconnected', 'disconnected');
            });

            socket.on('opponentDisconnected', () => {
                if (gameMode === 'ai' || gameMode === 'computer') return;
                setOpponentStatus('Opponent disconnected', 'disconnected');
            });

            socket.on('error', (msg) => {
                setIntentPending(false);
                showToast(msg);
                // Deploy race: our socket is fresh but joinRoom hasn't landed
                // yet (or the room was still loading from Redis). Retry the
                // join instead of leaving the player stuck with
                // "You are not in this room".
                if (typeof msg === 'string' && /not in this room|room not found/i.test(msg) && pendingJoin && pendingJoin.roomId) {
                    joinedRoomId = null;
                    emitJoin(pendingJoin.roomId);
                    scheduleRejoin();
                }
            });

            socket.on('disconnect', (reason) => {
                setIntentPending(false);
                showToast('Disconnected from server — reconnecting…');
                joinedRoomId = null;
                // Socket.IO auto-reconnects; on 'connect' we re-emit joinRoom.
                // Keep pendingJoin so the rejoin path above fires.
                console.log('[WS] disconnect:', reason);
            });
        }

        function createRoom(mode) {
            const s = connectSocket(null);
            // connectSocket returns null while the Socket.IO lib is still
            // loading — stay on the landing screen; the retry loop inside
            // connectSocket replays the connection once `io` exists.
            if (!s) return;
            // Wait for the socket handshake before emitting (page-load race).
            const payload = { mode };
            if (mode === 'computer') {
                // Include the selected difficulty for the local algorithm.
                const diffSel = document.getElementById('computer-difficulty');
                payload.difficulty = diffSel ? diffSel.value : 'medium';
            }
            if (socket.connected) socket.emit('createRoom', payload);
            else socket.once('connect', () => socket.emit('createRoom', payload));
            showLanding(false);
        }

        function joinByCode() {
            const code = document.getElementById('room-code').value.trim().toLowerCase();
            if (code.length < 4) { showToast('Enter a valid room code'); return; }
            roomId = code;
            gameState = null;
            pendingJoin = { roomId: code, playerId: (loadSeat(code) || {}).playerId || myPlayerId };
            const s = connectSocket(code);
            // Same guard as createRoom: if `io` isn't loaded yet, the retry
            // loop replays the join once it is — don't hide the landing page.
            if (!s) return;
            emitJoin(code);
            showLanding(false);
        }
