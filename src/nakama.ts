import {
  Client,
  type Match,
  type MatchData,
  type MatchmakerMatched,
  type Session,
  type Socket
} from "@heroiclabs/nakama-js";
import type { GameState, LeaderboardRow, RoomSummary } from "./types";

export const OpState = 1;
export const OpMove = 2;
export const OpNotice = 3;

const scheme = import.meta.env.VITE_NAKAMA_SCHEME ?? "http";
const host = import.meta.env.VITE_NAKAMA_HOST ?? "127.0.0.1";
const port = import.meta.env.VITE_NAKAMA_PORT ?? "7350";
const serverKey = import.meta.env.VITE_NAKAMA_SERVER_KEY ?? "defaultkey";
const useSsl = scheme === "https";

export interface NakamaConnection {
  client: Client;
  session: Session;
  socket: Socket;
  userId: string;
  username: string;
}

export interface JoinResult {
  matchId: string;
  presenceMark: string | null;
}

export async function connect(username: string): Promise<NakamaConnection> {
  const client = new Client(serverKey, host, port, useSsl);
  const deviceId = getDeviceId();
  const session = await client.authenticateDevice(deviceId, true, username);
  await client.updateAccount(session, { username });
  const socket = client.createSocket(useSsl);
  await socket.connect(session, true);
  return {
    client,
    session,
    socket,
    userId: session.user_id ?? "",
    username
  };
}

export async function createMatch(connection: NakamaConnection, timed: boolean): Promise<string> {
  const response = await connection.client.rpc(connection.session, "create_match", { timed });
  const payload = parseRpcPayload<{ matchId: string }>(response.payload);
  return payload.matchId;
}

export async function listRooms(connection: NakamaConnection, timed: boolean): Promise<RoomSummary[]> {
  const response = await connection.client.rpc(connection.session, "list_matches", { timed });
  const payload = parseRpcPayload<{ matches?: RoomSummary[] }>(response.payload);
  return payload.matches ?? [];
}

export async function joinMatch(connection: NakamaConnection, matchId: string): Promise<Match> {
  return connection.socket.joinMatch(matchId);
}

export async function joinMatchmaking(connection: NakamaConnection, timed: boolean): Promise<string> {
  const ticket = await connection.socket.addMatchmaker(`+properties.timed:${String(timed)}`, 2, 2, {
    timed: String(timed)
  });

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      connection.socket.removeMatchmaker(ticket.ticket).catch(() => undefined);
      reject(new Error("No opponent found yet. Try creating a room instead."));
    }, 20000);

    connection.socket.onmatchmakermatched = async (matched: MatchmakerMatched) => {
      window.clearTimeout(timeout);
      const match = await connection.socket.joinMatch(matched.match_id, matched.token);
      resolve(match.match_id);
    };
  });
}

export function sendMove(connection: NakamaConnection, matchId: string, cell: number) {
  connection.socket.sendMatchState(matchId, OpMove, JSON.stringify({ cell }));
}

export function sendRematch(connection: NakamaConnection, matchId: string) {
  connection.socket.sendMatchState(matchId, OpNotice, JSON.stringify({ rematch: true }));
}

export function parseMatchData(data: MatchData): GameState | { message: string } | null {
  const decoded = decode(data.data);
  if (!decoded) {
    return null;
  }
  return JSON.parse(decoded) as GameState | { message: string };
}

export async function loadLeaderboard(connection: NakamaConnection): Promise<LeaderboardRow[]> {
  const result = await connection.client.listLeaderboardRecords(connection.session, "tic_tac_toe_wins", undefined, 10);
  return (result.records ?? []).map((record) => ({
    ownerId: record.owner_id ?? "",
    username: record.username || "Player",
    rank: String(record.rank ?? ""),
    score: String(record.score ?? "0"),
    subscore: String(record.subscore ?? "0"),
    metadata: (record.metadata ?? {}) as LeaderboardRow["metadata"]
  }));
}

function getDeviceId() {
  const key = "nakama-tic-tac-toe-tab-device";
  const existing = window.sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return value;
}

function decode(data: string | Uint8Array): string {
  if (typeof data === "string") {
    return data;
  }
  return new TextDecoder().decode(data);
}

function parseRpcPayload<T extends object>(payload: unknown): T {
  if (!payload) {
    return {} as T;
  }
  if (typeof payload === "string") {
    return JSON.parse(payload) as T;
  }
  return payload as T;
}
