        // ============ Game Client ============
        const SOCKET_URL = window.location.origin;
        let socket = null;
        let gameState = null;
        let selection = null; // { col, row, piece }
        let armedEffect = null;
        let myAffiliation = null;
        let roomId = null;
        let gameMode = null;
        let myPlayerId = null;
        let lastTurnEffect = null;   // detect when a new turn's effect arrives
        let lastTurnCount = null;    // detect turn transitions
        let pendingIntent = false;
        let pendingAnimations = 0;

        // Serializes board transitions so a fast opponent move never starts
        // animating before the previous move's animation has finished.
        let animationQueue = Promise.resolve();
        function enqueueAnimation(task) {
            animationQueue = animationQueue.then(task).catch(() => {});
            return animationQueue;
        }
        function refreshBoardInputLock() {
            const grid = document.getElementById('board-grid');
            if (grid) grid.style.pointerEvents = (pendingIntent || pendingAnimations > 0) ? 'none' : '';
            updateEffectButtons();
        }
        function setIntentPending(value) {
            pendingIntent = value;
            refreshBoardInputLock();
        }

        // Persist our seat so closing the tab / reopening the same link
        // reclaims the SAME player slot instead of looking like a new player.
        function seatKey(rid) { return `nw:seat:${rid}`; }
        function saveSeat(rid, pid, affiliation) {
            try {
                if (rid && pid) localStorage.setItem(seatKey(rid), JSON.stringify({ playerId: pid, affiliation }));
            } catch (e) { /* private mode — reconnect just won't survive reload */ }
        }
        function loadSeat(rid) {
            try {
                const raw = rid && localStorage.getItem(seatKey(rid));
                return raw ? JSON.parse(raw) : null;
            } catch (e) { return null; }
        }
        const ACTIVE_ROOM_KEY = 'nw:active-room';
        function saveActiveRoom(rid) {
            try { if (rid) localStorage.setItem(ACTIVE_ROOM_KEY, rid); } catch (e) { /* ignore */ }
        }
        function loadActiveRoom() {
            try { return localStorage.getItem(ACTIVE_ROOM_KEY); } catch (e) { return null; }
        }
        function clearActiveRoom() {
            try { localStorage.removeItem(ACTIVE_ROOM_KEY); } catch (e) { /* ignore */ }
        }

        const host = window.location.host;
        // Backend URL: explicit override (Vercel client → Railway backend),
        // otherwise fall back to the same origin that served this page.
        const BACKEND_URL = (window.NW_CONFIG && window.NW_CONFIG.BACKEND_URL)
            ? window.NW_CONFIG.BACKEND_URL
            : (host.includes('localhost') ? `http://${host}` : SOCKET_URL);

        // ============ Tips ============
        // Each tip now states the exact caps so a player is never surprised
        // by a stat clamping down mid-action.
        const TIPS = {
            Merge: "Merge adds two pieces' strength (cap 8) and armor (cap 10), keeps the better range, and spikes shed to the new strength's cap.",
            Split: "Split halves every stat — only even strengths (2→1, 4→2, 6→3, 8→4) can split. Spikes round down.",
            Weaken: "Weaken drops 1 from strength, armor and range (min 1) on yours OR the enemy's. Spikes are untouched — never reduced. Lowering strength raises the spike cap by 1. A 1/1/1 piece is invulnerable.",
            Strengthen: "Strengthen doubles strength (cap 8) at a cost: armor drops by the strength gained, and spikes shed to the new strength's cap.",
            default: "Strength caps at 8. Spike cap = 10 − strength: a 1 holds 9 spikes, an 8 holds only 2."
        };

        // Per-effect icon, label and accent color for the arrival toast + chip.
        const EFFECT_META = {
            Merge: { icon: '➕', label: 'Merge', tip: 'move onto an ally to combine' },
            Split: { icon: '➗', label: 'Split', tip: 'halve one of your pieces' },
            Weaken: { icon: '➖', label: 'Weaken', tip: 'shrink any piece by 1 (1s are immune)' },
            Strengthen: { icon: '✖️', label: 'Strengthen', tip: 'double attack, lose armor' },
        };

        function getTip(effect) {
            return TIPS[effect] || TIPS.default;
        }

        // The spike cap table, shown as a compact legend so players learn
        // which pieces can hoard spikes without being surprised by clamping.
        function spikeCap(strength) {
            return Math.max(2, 10 - strength);
        }

        let pendingJoin = null; // { roomId, playerId }
        let rejoinTimer = null;
        let joinedRoomId = null;

        const EFFECT_COLORS = {
            Merge: { bg: '#DCFCE7', fg: '#15803D', toast: '🟢' },
            Split: { bg: '#E0F2FE', fg: '#0369A1', toast: '🔵' },
            Weaken: { bg: '#FEF3C7', fg: '#B45309', toast: '🟡' },
            Strengthen: { bg: '#EDE9FE', fg: '#6D28D9', toast: '🟣' },
        };

        // Side panel shows the last 15 entries; the explorer modal shows
        // everything with filters.
        let historyFilter = 'all'; // 'all' | 'blue' | 'red'
        let historySearch = '';
