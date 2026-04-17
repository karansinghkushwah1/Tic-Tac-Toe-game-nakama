import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchData } from "@heroiclabs/nakama-js";
import {
  connect,
  createMatch,
  joinMatch,
  joinMatchmaking,
  listRooms,
  loadLeaderboard,
  OpNotice,
  OpState,
  parseMatchData,
  sendMove,
  sendRematch,
  type NakamaConnection
} from "./nakama";
import type { GameState, LeaderboardRow, RoomSummary } from "./types";

const emptyState: GameState = {
  board: ["", "", "", "", "", "", "", "", ""],
  turn: "X",
  winner: "",
  winningLine: [],
  status: "waiting",
  timed: false,
  remainingSeconds: null,
  players: [],
  spectators: 0,
  rematchRequested: {}
};

const names = ["Ada", "Grace", "Linus", "Mira", "Ken", "Radia", "Edsger"];

export default function App() {
  const [username, setUsername] = useState(defaultName);
  const [connection, setConnection] = useState<NakamaConnection | null>(null);
  const [matchId, setMatchId] = useState("");
  const [manualMatchId, setManualMatchId] = useState("");
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [state, setState] = useState<GameState>(emptyState);
  const [timed, setTimed] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Choose a mode, then create a room or find an opponent.");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const previousStatus = useRef<GameState["status"]>("waiting");

  const me = useMemo(() => {
    if (!connection) {
      return null;
    }
    return state.players.find((player) => player.userId === connection.userId) ?? null;
  }, [connection, state.players]);

  const currentPlayer = state.players.find((player) => player.mark === state.turn);
  const statusText = getStatusText(state, me?.mark ?? null, currentPlayer?.username ?? "Opponent");

  useEffect(() => {
    if (!connection) {
      return;
    }

    connection.socket.onmatchdata = (data: MatchData) => {
      const payload = parseMatchData(data);
      if (!payload) {
        return;
      }
      if (data.op_code === OpState) {
        setState(payload as GameState);
      }
      if (data.op_code === OpNotice && "message" in payload) {
        setNotice(payload.message);
        setToast(payload.message);
      }
    };
  }, [connection]);

  useEffect(() => {
    if (!connection || !me) {
      previousStatus.current = state.status;
      return;
    }

    if (state.status === "finished" && previousStatus.current !== "finished") {
      const message = getResultToast(state, me.mark);
      setToast(message);
      setNotice(message);
      loadLeaderboard(connection).then(setLeaderboard).catch(() => undefined);
    }

    if (state.status === "playing" && previousStatus.current === "finished") {
      setNotice("Rematch started.");
      setToast("Rematch started.");
    }

    previousStatus.current = state.status;
  }, [connection, me, state]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function signIn() {
    await run(async () => {
      const active = await connect(username.trim() || defaultName());
      setConnection(active);
      setNotice(`Connected as ${active.username}.`);
      setLeaderboard(await loadLeaderboard(active));
      await refreshRooms(active);
    });
  }

  async function refreshRooms(active = connection) {
    if (!active) {
      return;
    }
    const nextRooms = await listRooms(active, timed);
    setRooms(nextRooms);
  }

  async function createRoom() {
    if (!connection) {
      return;
    }
    await run(async () => {
      const id = await createMatch(connection, timed);
      await enterMatch(id);
      setNotice("Room created. Share the room code or wait for another player.");
    });
  }

  async function enterMatch(id: string) {
    if (!connection || !id.trim()) {
      return;
    }
    const match = await joinMatch(connection, id.trim());
    setMatchId(match.match_id);
    setManualMatchId(match.match_id);
    setNotice("Joined match. Waiting for server state.");
  }

  async function autoMatch() {
    if (!connection) {
      return;
    }
    await run(async () => {
      setNotice("Searching for an opponent...");
      const id = await joinMatchmaking(connection, timed);
      setMatchId(id);
      setManualMatchId(id);
      setNotice("Opponent found. Match joined.");
    });
  }

  async function makeMove(cell: number) {
    if (!connection || !matchId || state.status !== "playing" || state.board[cell] || me?.mark !== state.turn) {
      return;
    }
    sendMove(connection, matchId, cell);
  }

  async function rematch() {
    if (!connection || !matchId) {
      return;
    }
    sendRematch(connection, matchId);
    setNotice("Rematch requested. Waiting for the other player.");
  }

  async function refreshLeaderboard() {
    if (!connection) {
      return;
    }
    await run(async () => {
      setLeaderboard(await loadLeaderboard(connection));
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="appShell">
      {toast && <div className="toast" role="status">{toast}</div>}
      <section className="hero">
        <div>
          <p className="eyebrow">Nakama authoritative multiplayer</p>
          <h1>Tic-Tac-Toe Arena</h1>
          <p className="heroText">Create rooms, discover open games, or jump into matchmaking. Every move is validated by the Nakama match runtime.</p>
        </div>
        <div className="connectionPanel" aria-label="Connection panel">
          <label htmlFor="username">Player name</label>
          <div className="inlineControls">
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={18} />
            <button onClick={signIn} disabled={busy || !!connection}>{connection ? "Connected" : "Connect"}</button>
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="playArea">
          <div className="toolbar">
            <div className="segmented" aria-label="Game mode">
              <button className={!timed ? "selected" : ""} onClick={() => setTimed(false)} disabled={!!matchId}>Classic</button>
              <button className={timed ? "selected" : ""} onClick={() => setTimed(true)} disabled={!!matchId}>30s turns</button>
            </div>
            <button onClick={() => refreshRooms()} disabled={!connection || busy}>Refresh</button>
          </div>

          <div className="statusStrip">
            <strong>{statusText}</strong>
            <span>{matchId ? `Room ${shortId(matchId)}` : "No active room"}</span>
            {state.timed && <span className="timer">{state.remainingSeconds ?? 0}s</span>}
          </div>

          <div className="board" aria-label="Tic tac toe board">
            {state.board.map((cell, index) => (
              <button
                key={index}
                className={state.winningLine.includes(index) ? "cell winCell" : "cell"}
                onClick={() => makeMove(index)}
                disabled={!connection || !matchId || state.status !== "playing" || !!cell || me?.mark !== state.turn}
                aria-label={`Cell ${index + 1}`}
              >
                {cell}
              </button>
            ))}
          </div>

          <div className="notice" role="status">
            {error || notice}
          </div>

          {state.status === "finished" && me && (
            <button className="primaryWide" onClick={rematch} disabled={!!state.rematchRequested[me.userId]}>
              {state.rematchRequested[me.userId] ? "Rematch requested" : "Request rematch"}
            </button>
          )}
        </div>

        <aside className="sidePanel">
          <section className="panel">
            <h2>Players</h2>
            <div className="players">
              {["X", "O"].map((mark) => {
                const player = state.players.find((item) => item.mark === mark);
                return (
                  <div className="playerRow" key={mark}>
                    <span className="mark">{mark}</span>
                    <span>{player?.username ?? "Waiting..."}</span>
                    <small>
                      {player
                        ? state.status === "finished" && state.rematchRequested[player.userId]
                          ? "rematch ready"
                          : player.connected
                            ? "online"
                            : "reconnecting"
                        : "open seat"}
                    </small>
                  </div>
                );
              })}
            </div>
            <p className="metaLine">{state.spectators} spectator{state.spectators === 1 ? "" : "s"}</p>
          </section>

          <section className="panel">
            <h2>Rooms</h2>
            <div className="buttonGrid">
              <button onClick={createRoom} disabled={!connection || busy}>Create</button>
              <button onClick={autoMatch} disabled={!connection || busy}>Matchmake</button>
            </div>
            <div className="joinLine">
              <input placeholder="Room id" value={manualMatchId} onChange={(event) => setManualMatchId(event.target.value)} />
              <button onClick={() => run(() => enterMatch(manualMatchId))} disabled={!connection || busy}>Join</button>
            </div>
            <div className="roomList">
              {rooms.length === 0 && <p className="empty">No open rooms in this mode.</p>}
              {rooms.map((room) => (
                <button key={room.matchId} onClick={() => run(() => enterMatch(room.matchId))}>
                  <span>{shortId(room.matchId)}</span>
                  <small>{room.size}/2 players</small>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panelHeading">
              <h2>Leaderboard</h2>
              <button className="iconButton" onClick={refreshLeaderboard} disabled={!connection || busy} aria-label="Refresh leaderboard">R</button>
            </div>
            <div className="leaderboard">
              {leaderboard.length === 0 && <p className="empty">Play a finished match to create rankings.</p>}
              {leaderboard.map((row) => (
                <div className="leaderRow" key={row.ownerId}>
                  <strong>#{row.rank}</strong>
                  <span>{row.username}</span>
                  <small>{row.score} wins / {row.metadata?.streak ?? 0} streak</small>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function defaultName() {
  return `${names[Math.floor(Math.random() * names.length)]}-${Math.floor(100 + Math.random() * 900)}`;
}

function shortId(matchId: string) {
  return matchId.slice(0, 8);
}

function getStatusText(state: GameState, myMark: string | null, turnOwner: string) {
  if (state.status === "waiting") {
    return "Waiting for another player";
  }
  if (state.status === "finished") {
    if (state.winner === "draw") {
      return "Draw game";
    }
    if (state.winner && myMark === state.winner) {
      return "You won";
    }
    if (state.winner) {
      return `${state.winner} won`;
    }
  }
  if (myMark === state.turn) {
    return "Your turn";
  }
  return `${turnOwner}'s turn`;
}

function getResultToast(state: GameState, myMark: string) {
  if (state.winner === "draw") {
    return "Draw game.";
  }
  if (state.winner === myMark) {
    return "You won!";
  }
  return "You lost.";
}
