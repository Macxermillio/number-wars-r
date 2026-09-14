        // ============ Interaction Model ============
        // Mirrors the server's mergeEffect() checks: range (Chebyshev distance),
        // rook straight-line rule for strength 5-8, and a clear path between
        // the two squares. Used to decide which ally pieces are merge targets.
        function canMergeInto(selPiece, targetPos) {
            const [sc, sr] = selPiece.position;
            const [tc, tr] = targetPos;
            const dx = tc - sc;
            const dy = tr - sr;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));
            if (dist === 0 || dist > selPiece.range) return false;
            // Rooks (strength 5-8) move in straight lines only
            if (selPiece.strength >= 5 && dx !== 0 && dy !== 0) return false;
            // Pieces 1-4 may move straight OR on a true diagonal only — reject
            // knight-like offsets such as (2,1), exactly as the server does.
            if (selPiece.strength < 5 && dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;
            // Every square between must be clear (no brick, no piece)
            const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
            const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
            for (let i = 1; i < dist; i++) {
                const key = `${sc + stepX * i},${sr + stepY * i}`;
                const sq = gameState.board[key];
                if (!sq || sq.bricked || sq.occupied) return false;
            }
            return true;
        }

        // Like canSelectMoveTo, but for landing ON an enemy piece to capture it.
        // The destination is occupied by the enemy, so we skip the "destination
        // must be empty" check and just require the path up to (but not including)
        // the enemy square to be clear.
        function canCaptureOnto(piece, targetPos) {
            const [sc, sr] = piece.position;
            const [tc, tr] = targetPos;
            const dx = tc - sc;
            const dy = tr - sr;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));

            if (dist === 0 || dist > piece.range) return false;
            if (piece.strength >= 5 && dx !== 0 && dy !== 0) return false;
            if (piece.strength < 5 && dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;

            const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
            const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
            for (let i = 1; i < dist; i++) {
                const key = `${sc + stepX * i},${sr + stepY * i}`;
                const sq = gameState.board[key];
                if (!sq || sq.bricked || sq.occupied) return false;
            }
            return true;
        }

        // Mirrors the server's validateMove(): checks the selected piece can legally
        // move to (targetCol, targetRow) — proper rook (strength >= 5, straight only)
        // vs queen (strength <= 4, straight + diagonal) movement, within range, and
        // a clear path. Returns true only for genuinely legal destinations.
        function canSelectMoveTo(piece, targetPos) {
            const [sc, sr] = piece.position;
            const [tc, tr] = targetPos;
            const dx = tc - sc;
            const dy = tr - sr;
            const dist = Math.max(Math.abs(dx), Math.abs(dy));

            // Zero-length move (clicking the piece itself) is not a destination.
            if (dist === 0 || dist > piece.range) return false;

            // Rooks (strength 5-8) move in straight lines only.
            if (piece.strength >= 5 && dx !== 0 && dy !== 0) return false;
            // Pieces 1-4 may also move diagonally, but not with a knight-like
            // offset such as two columns and one row.
            if (piece.strength < 5 && dx !== 0 && dy !== 0 && Math.abs(dx) !== Math.abs(dy)) return false;

            // Every square between must be clear (no brick, no piece).
            const stepX = dx === 0 ? 0 : dx / Math.abs(dx);
            const stepY = dy === 0 ? 0 : dy / Math.abs(dy);
            for (let i = 1; i < dist; i++) {
                const key = `${sc + stepX * i},${sr + stepY * i}`;
                const sq = gameState.board[key];
                if (!sq || sq.bricked || sq.occupied) return false;
            }

            // Destination must exist and not be bricked (the board grid only shows
            // this branch for empty cells, so occupancy is already excluded).
            const dest = gameState.board[`${tc},${tr}`];
            if (!dest || dest.bricked) return false;

            return true;
        }

        function canUseEffectOn(effect, piece) {
            if (!piece) return false;
            if (effect === 'split') {
                if (piece.affiliation !== myAffiliation || ![2, 4, 6, 8].includes(piece.strength)) return false;
                const [col, row] = piece.position;
                return [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [-1,1], [0,1], [1,1]]
                    .some(([dc, dr]) => {
                        const square = gameState.board[`${col + dc},${row + dr}`];
                        return square && !square.bricked && !square.occupied && !square.tenant
                            && !square.shard && !square.star;
                    });
            }
            if (effect === 'weaken') {
                return !(piece.strength === 1 && piece.armor === 1 && piece.range === 1);
            }
            if (effect === 'strengthen') return piece.strength < 8;
            return false;
        }

        function handlePieceClick(col, row, piece) {
            if (!gameState || gameState.gameOver || pendingIntent || pendingAnimations > 0) return;
            if (gameState.turn !== myAffiliation) return;
            hidePieceTooltip();

            // Clicking the selected piece again deselects it and hides stats.
            if (selection && selection.col === col && selection.row === row) {
                selection = null;
                armedEffect = null;
                updateStatsCard();
                renderGame(gameState);
                return;
            }

            // If armed effect, clicking your own piece applies the effect.
            // Split only arms your own pieces; Weaken/Strengthen arm any piece.
            if (armedEffect) {
                if (!canUseEffectOn(armedEffect, piece)) {
                    showToast('That effect cannot be used on this piece');
                    return;
                }
                setIntentPending(true);
                socket.emit('useEffect', {
                    roomId,
                    effect: armedEffect,
                    targetPosition: [col, row],
                });
                armedEffect = null;
                return;
            }

            // MERGE: with another piece selected on a Merge turn, clicking a
            // different ally piece is a merge intent — move onto the ally.
            if (selection && gameState.turnEffect === 'Merge'
                && piece.affiliation === myAffiliation
                && selection.piece.affiliation === myAffiliation
                && canMergeInto(selection.piece, [col, row])) {
                setIntentPending(true);
                socket.emit('move', {
                    roomId,
                    destination: [col, row],
                    fromPosition: [selection.col, selection.row],
                });
                selection = null;
                armedEffect = null;
                return;
            }

            // Select this piece
            selection = { col, row, piece };
            updateStatsCard();
            renderGame(gameState);
        }

        function handleDestinationClick(col, row) {
            if (!gameState || gameState.gameOver || pendingIntent || pendingAnimations > 0) return;
            if (gameState.turn !== myAffiliation) return;
            hidePieceTooltip();

            // Armed effect takes priority over a move — an armed Weaken or
            // Strengthen can target an enemy (or ally) with no selection.
            if (armedEffect) {
                const target = gameState.board[`${col},${row}`]?.tenant;
                if (!canUseEffectOn(armedEffect, target)) {
                    showToast('That effect cannot be used on this piece');
                    return;
                }
                setIntentPending(true);
                socket.emit('useEffect', {
                    roomId,
                    effect: armedEffect,
                    targetPosition: [col, row],
                });
                armedEffect = null;
                selection = null;
                return;
            }

            if (!selection) return;

            const destination = gameState.board[`${col},${row}`];
            const legal = destination?.tenant
                ? destination.tenant.affiliation !== myAffiliation && canCaptureOnto(selection.piece, [col, row])
                : canSelectMoveTo(selection.piece, [col, row]);
            if (!legal) {
                showToast('That piece cannot move there');
                return;
            }

            // Send move intent
            setIntentPending(true);
            socket.emit('move', {
                roomId,
                destination: [col, row],
                fromPosition: [selection.col, selection.row],
            });

            selection = null;
            armedEffect = null;
        }

        // ============ Effects ============
        // The Active Ability pill IS the button — tap it to arm/disarm the
        // turn's effect, then tap a piece on the board to apply it.
        function toggleArmedFromChip() {
            if (!gameState || gameState.gameOver) return;
            if (myAffiliation !== gameState.turn) return;
            if (gameState.turnEffect === 'Merge') return; // implicit, nothing to arm
            armEffect(gameState.turnEffect.toLowerCase());
        }

        function armEffect(effect) {
            if (armedEffect === effect) {
                armedEffect = null;
            } else {
                armedEffect = effect;
                // Deselect any selected piece — an effect is a separate action
                // from a move, and armed effects target any valid piece.
                selection = null;
            }
            updateEffectButtons();
            renderGame(gameState);
        }
