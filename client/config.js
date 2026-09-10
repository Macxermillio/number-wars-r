// ============================================================
// Number Wars — Client config
// ============================================================
// This is the single place to tell the client where the backend lives.
//
//   • LOCAL DEV / single Railway deploy (server also serves the client):
//       leave BACKEND_URL empty ("") → the client connects to the same
//       origin that served this page. Nothing to change.
//
//   • CLIENT ON VERCEL + BACKEND ON RAILWAY:
//       set BACKEND_URL to your Railway backend URL, e.g.
//       window.NW_CONFIG = { BACKEND_URL: "https://your-app.up.railway.app" };
//
// On Vercel you can also inject this at build time via an env var
// (VITE_BACKEND_URL / NEXT_PUBLIC_BACKEND_URL) if you add a build step.
// ============================================================
window.NW_CONFIG = {
    // TODO: set this to your Railway backend URL once the service exists,
    // e.g. "https://number-wars-production.up.railway.app"
    BACKEND_URL: ""
};