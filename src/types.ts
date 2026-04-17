export type Mark = "X" | "O" | "";
export type GameStatus = "waiting" | "playing" | "finished";

export interface Player {
  userId: string;
  username: string;
  mark: "X" | "O";
  connected: boolean;
}

export interface GameState {
  board: Mark[];
  turn: "X" | "O";
  winner: "X" | "O" | "draw" | "";
  winningLine: number[];
  status: GameStatus;
  timed: boolean;
  remainingSeconds: number | null;
  players: Player[];
  spectators: number;
  rematchRequested: Record<string, boolean>;
}

export interface RoomSummary {
  matchId: string;
  size: number;
  label: string;
}

export interface LeaderboardRow {
  ownerId: string;
  username: string;
  rank: string;
  score: string;
  subscore: string;
  metadata?: {
    losses?: number;
    draws?: number;
    streak?: number;
  };
}
