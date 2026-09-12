// Shared message types for server components
import type { Affiliation } from "../assets/pieces.ts";

// The intent a client (or AI) sends: a move or an effect
export interface MoveIntent {
    type: "move";
    roomId: string;
    pieceId: string | null; // null for client-derived selection
    destination: [number, number];
}

export interface EffectIntent {
    type: "useEffect";
    roomId: string;
    effect: "split" | "weaken" | "strengthen";
    targetId: string | null;
}

export type Intent = MoveIntent | EffectIntent;

// Worker protocol (main ↔ worker)
export interface SearchRequest {
    id: number;
    state: unknown; // serialized gameState
}

export interface SearchResponse {
    id: number;
    move: { pieceId: string; destination: [number, number] } | null;
    error?: string;
}

// Room types
export type GameMode = "friend" | "ai" | "computer";

export interface PlayerSlot {
    playerId: string;
    socketId: string | null;
    affiliation: Affiliation;
    connected: boolean;
    disconnectedAt?: number;
}

export interface Room {
    roomId: string;
    state: unknown; // gameState
    players: PlayerSlot[];
    mode: GameMode;
    host: string;
    createdAt: number;
    thinking: boolean; // true while AI/computer is computing a move
    difficulty?: "easy" | "medium" | "hard" | "insane"; // computer mode only
    lastActivityAt?: number; // ms epoch of last game action (move/effect/join/rematch); drives 1h idle expiry
}

// Client events (from ARCHITECTURE §11)
export interface ClientToServerEvents {
    createRoom: (data: { mode: GameMode; difficulty?: "easy" | "medium" | "hard" | "insane" }) => void;
    joinRoom: (data: { roomId: string; playerId?: string }) => void;
    move: (data: { roomId: string; destination: [number, number]; fromPosition?: [number, number] }) => void;
    useEffect: (data: { roomId: string; effect: "split" | "weaken" | "strengthen"; targetPosition: [number, number] }) => void;
    rematch: (data: { roomId: string }) => void;
    leaveRoom: (data: { roomId: string }) => void;
}

export interface ServerToClientEvents {
    gameState: (state: unknown) => void;
    playerDisconnected: (data?: { affiliation?: Affiliation; playerId?: string }) => void;
    opponentDisconnected: (data?: { affiliation?: Affiliation; playerId?: string }) => void;
    opponentReconnected: (data?: { affiliation?: Affiliation; playerId?: string }) => void;
    opponentJoined: () => void;
    error: (msg: string) => void;
    roomCreated: (data: { roomId: string; link: string; mode?: GameMode; difficulty?: string; playerId: string; affiliation: Affiliation }) => void;
    roomJoined: (data: { roomId: string; mode: GameMode; affiliation: Affiliation; playerId: string }) => void;
}

// LLM response type
export interface AiMove {
    pieceId: string;
    destination: [number, number];
}