# Number Wars

An authoritative, real-time multiplayer turn-based strategy game featuring high-performance AI engines, tactical LLM-powered gameplay commentary, and low-latency state synchronization.

Built with **TypeScript**, **Node.js**, **Socket.IO**, and **HTML5 Canvas**, deployed on **Railway** (backend) and **Vercel**(frontend).

---

## Overview

**Number Wars** blends turn-based positional board play with tactical mechanics and real-time multiplayer architecture. Players compete on an authoritative board grid where strategic movement, active piece effects, and board control determine victory.

The platform supports:
- **Real-Time Multiplayer (PvP):** Room-based matchmaking, challenge/invite links, reconnect resilience, and low-latency state persistence via Redis.
- **Multi-Tiered Game AI:** A Minimax engine with alpha-beta pruning and heuristic evaluation, offloaded to Worker Threads to keep the main event loop non-blocking.
- **LLM Commentary & Advice:** Tactical analysis, moves evaluations, and conversational coaching integrated through structured prompt pipelines.

---

## Features

### Real-Time Networking & State Synchronization
- **Authoritative Server:** Move validation, piece combat resolution, and state mutations are strictly verified on the backend.
- **State Persistence & Caching:** Uses Redis to cache ongoing game states, match rooms, and session metadata for sub-millisecond lookups and disconnect recovery.
- **WebSocket Protocol:** Event-driven architecture using Socket.IO for action streaming, chat, match lifecycle, and real-time board updates.

### Engine & AI Systems
- **Minimax Search with Alpha-Beta Pruning:** Calculates deep tactical responses based on piece values, mobility, and positional control.
- **Worker Thread Offloading:** Computations for intensive depth-based search routines run inside dedicated Node.js Worker Threads (`search-worker.ts`), preventing socket latency or loop freezes.
- **LLM Tactical Intent & Commentary:** Prompts tailored for game state assessment, tactical insights, move rationale, and player encouragement.

### Client Experience
- **Lightweight Canvas Interface:** Responsive board rendering via pure HTML5 Canvas and CSS.
- **Lobby & Matchmaking:** Create open rooms, invite friends via direct link, or practice against varying difficulty levels of AI.

---

## Tech Stack

- **Backend:** Node.js, TypeScript, Express, Socket.IO
- **Storage / Cache:** Redis
- **AI & Search:** Custom Minimax + Alpha-Beta pruning, Heuristic evaluation tables, Node.js Worker Threads, LLM intent wrappers
- **Testing:** Node Test Runner / TypeScript test suite, GitHub Actions CI
- **Frontend:** Vanilla TypeScript / JavaScript, HTML5 Canvas, Socket.IO Client, Vercel
- **Infrastructure & Deployment:** Railway (API & WebSockets), Vercel (Client App)

---

## Architecture

```text
client/
├── css/             # Stylesheets and lobby/board UI rules
├── js/
│   ├── interactions.js # Board click/touch listeners & user inputs
│   ├── render.js       # HTML5 Canvas board & piece rendering
│   ├── socket.js       # Client Socket.IO event listeners & dispatchers
│   ├── state.js        # Client-side state cache
│   └── ui.js           # Lobby modals, invite popups, chat DOM elements
backend/
├── assets/          # Base mechanics, piece definitions, and rulesets
├── server/
│   ├── ai/
│   │   ├── heuristic.ts     # Positional scoring & board evaluations
│   │   ├── llm.ts           # Commentary and structured LLM responses
│   │   ├── minimax.ts       # Minimax search with alpha-beta pruning
│   │   ├── search-worker.ts # Multi-threaded background search worker
│   │   └── simulation.ts    # Board state cloning & simulation rollouts
│   ├── intents.ts   # Player action parsing and intent verification
│   ├── protocol.ts  # Socket.IO event names, payloads, and message schemas
│   ├── redis.ts     # Redis client connection and room state caching
│   └── main.ts      # HTTP server bootstrap, Socket.IO routing, matchmaking
└── tests/           # Automated suites (mechanics, minimax, PvP invites, Redis)
