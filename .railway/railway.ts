import { defineRailway, github, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("number-wars", {
    source: github("Macxermillio/number-wars-r", {
      rootDirectory: "backend",
    }),
    // Nixpacks auto-detects Node.js from package.json; no build step needed.
    // `npm start` runs `tsx index.ts` (the codebase uses worker_threads with
    // .ts worker URLs, so it must run under tsx, not a compiled build).
    start: "npm start",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    env: {
      // Frontend origin (Vercel). Set LLM_API_KEY in the Railway dashboard.
      CORS_ORIGIN: "https://number-wars-r.vercel.app",
      NODE_ENV: "production",
    },
  });

  return project("number-wars-r", {
    resources: [web],
  });
});