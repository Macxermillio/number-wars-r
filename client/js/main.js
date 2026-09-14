        // Check URL for /:roomId and the legacy /play/:roomId form.
        function checkUrlForRoom() {
            const match = window.location.pathname.match(/^\/play\/([a-z0-9]+)\/?$/i)
                || window.location.pathname.match(/^\/([a-z0-9]+)\/?$/i);
            const code = match ? match[1] : loadActiveRoom();
            if (code) {
                document.getElementById('room-code').value = code;
                joinByCode();
            }
        }
        checkUrlForRoom();

        // ============ Initial ============
        console.log('Number Wars client loaded');
