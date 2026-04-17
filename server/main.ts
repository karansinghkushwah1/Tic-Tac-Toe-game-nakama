type Json = Record<string, unknown>;

const OpState = 1;
const OpMove = 2;
const OpNotice = 3;

const Empty = "";
const X = "X";
const O = "O";
const TurnSeconds = 30;
const ReconnectSeconds = 20;

interface PlayerState {
  userId: string;
  username: string;
  presence: nkruntime.Presence;
  mark: string;
  connected: boolean;
}

interface GameState {
  players: PlayerState[];
  spectators: nkruntime.Presence[];
  board: string[];
  turn: string;
  winner: string;
  winningLine: number[];
  status: "waiting" | "playing" | "finished";
  timed: boolean;
  turnDeadline: number;
  emptyTicks: number;
  disconnectDeadlines: Record<string, number>;
  rematchRequested: Record<string, boolean>;
}

function InitModule(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
  initializer.registerMatch("tic_tac_toe", matchHandler);
  initializer.registerMatchmakerMatched(matchmakerMatched);
  initializer.registerRpc("create_match", rpcCreateMatch);
  initializer.registerRpc("list_matches", rpcListMatches);
  try {
    _nk.leaderboardCreate("tic_tac_toe_wins", true, "desc", "best", "", {});
  } catch (_error) {
    logger.debug("tic_tac_toe_wins leaderboard already exists");
  }
  logger.info("tic_tac_toe runtime loaded");
}

function matchmakerMatched(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matched: nkruntime.MatchmakerResult[]): string {
  const timed = matched.length > 0 && matched[0].properties && matched[0].properties.timed === "true";
  const matchId = nk.matchCreate("tic_tac_toe", { timed: timed });
  logger.debug("matchmaker created authoritative match %s", matchId);
  return matchId;
}

function rpcCreateMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const input = parseJson(payload);
  const timed = input.timed === true;
  const matchId = nk.matchCreate("tic_tac_toe", { timed: timed });
  logger.debug("created match %s by %s", matchId, ctx.userId);
  return JSON.stringify({ matchId: matchId });
}

function rpcListMatches(_ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  const input = parseJson(payload);
  const timed = input.timed === true;
  const matches = nk.matchList(20, true, "", 0, 1, "+label.open:true +label.timed:" + String(timed));
  return JSON.stringify({
    matches: matches.map(function (match) {
      return {
        matchId: match.matchId,
        size: match.size,
        label: match.label
      };
    })
  });
}

const matchHandler: nkruntime.MatchHandler<GameState> = {
  matchInit: matchInit,
  matchJoinAttempt: matchJoinAttempt,
  matchJoin: matchJoin,
  matchLeave: matchLeave,
  matchLoop: matchLoop,
  matchTerminate: matchTerminate,
  matchSignal: matchSignal
};

function matchInit(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, params: Record<string, unknown>): nkruntime.MatchInitResult<GameState> {
  const timed = params.timed === true || params.timed === "true";
  return {
    state: {
      players: [],
      spectators: [],
      board: [Empty, Empty, Empty, Empty, Empty, Empty, Empty, Empty, Empty],
      turn: X,
      winner: Empty,
      winningLine: [],
      status: "waiting",
      timed: timed,
      turnDeadline: 0,
      emptyTicks: 0,
      disconnectDeadlines: {},
      rematchRequested: {}
    },
    tickRate: 1,
    label: JSON.stringify({ open: true, timed: timed, status: "waiting" })
  };
}

function matchJoinAttempt(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: GameState, presence: nkruntime.Presence): nkruntime.MatchJoinAttemptResult<GameState> {
  if (state.players.length < 2 || findPlayer(state, presence.userId) >= 0) {
    return { state: state, accept: true };
  }
  return { state: state, accept: true };
}

function matchJoin(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, presences: nkruntime.Presence[]): nkruntime.MatchStateResult<GameState> {
  presences.forEach(function (presence) {
    const existing = findPlayer(state, presence.userId);
    if (existing >= 0) {
      state.players[existing].presence = presence;
      state.players[existing].connected = true;
      delete state.disconnectDeadlines[presence.userId];
      return;
    }

    if (state.players.length < 2 && state.status !== "finished") {
      const mark = state.players.length === 0 ? X : O;
      state.players.push({
        userId: presence.userId,
        username: displayName(presence),
        presence: presence,
        mark: mark,
        connected: true
      });
    } else {
      state.spectators.push(presence);
    }
  });

  if (state.players.length === 2 && state.status === "waiting") {
    state.status = "playing";
    state.turnDeadline = state.timed ? tick + TurnSeconds : 0;
    dispatcher.matchLabelUpdate(JSON.stringify({ open: false, timed: state.timed, status: state.status }));
  }

  broadcastState(dispatcher, state, tick);
  return { state: state };
}

function matchLeave(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, presences: nkruntime.Presence[]): nkruntime.MatchStateResult<GameState> {
  presences.forEach(function (presence) {
    const index = findPlayer(state, presence.userId);
    if (index >= 0) {
      state.players[index].connected = false;
      state.disconnectDeadlines[presence.userId] = tick + ReconnectSeconds;
    }
    removeSpectator(state, presence.userId);
  });
  broadcastState(dispatcher, state, tick);
  return { state: state };
}

function matchLoop(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, messages: nkruntime.MatchMessage[]): nkruntime.MatchStateResult<GameState> | null {
  if (state.players.length === 0 && state.spectators.length === 0) {
    state.emptyTicks += 1;
    if (state.emptyTicks > 10) {
      return null;
    }
  } else {
    state.emptyTicks = 0;
  }

  messages.forEach(function (message) {
    if (message.opCode === OpMove) {
      handleMove(logger, nk, dispatcher, tick, state, message);
    } else if (message.opCode === OpNotice) {
      handleRematch(dispatcher, tick, state, message);
    }
  });

  if (state.status === "playing") {
    Object.keys(state.disconnectDeadlines).forEach(function (userId) {
      if (tick >= state.disconnectDeadlines[userId]) {
        finishByForfeit(nk, dispatcher, tick, state, userId, "disconnect");
      }
    });

    if (state.timed && state.turnDeadline > 0 && tick >= state.turnDeadline) {
      const current = currentPlayer(state);
      if (current) {
        finishByForfeit(nk, dispatcher, tick, state, current.userId, "timeout");
      }
    }

    if (state.status === "playing" && state.timed) {
      broadcastState(dispatcher, state, tick);
    }
  }

  return { state: state };
}

function matchTerminate(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, _graceSeconds: number): nkruntime.MatchStateResult<GameState> {
  broadcastState(dispatcher, state, tick);
  return { state: state };
}

function matchSignal(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: GameState, data: string): nkruntime.MatchSignalResult<GameState> {
  return { state: state, data: data };
}

function handleMove(logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, message: nkruntime.MatchMessage) {
  if (state.status !== "playing") {
    sendError(dispatcher, message.sender, "Game is not active.");
    return;
  }

  const player = playerForPresence(state, message.sender.userId);
  if (!player) {
    sendError(dispatcher, message.sender, "Spectators cannot move.");
    return;
  }

  if (player.mark !== state.turn) {
    sendError(dispatcher, message.sender, "It is not your turn.");
    return;
  }

  const input = parseJson(nk.binaryToString(message.data));
  const cell = Number(input.cell);
  if (cell < 0 || cell > 8 || Math.floor(cell) !== cell) {
    sendError(dispatcher, message.sender, "Invalid board cell.");
    return;
  }

  if (state.board[cell] !== Empty) {
    sendError(dispatcher, message.sender, "That cell is already occupied.");
    return;
  }

  state.board[cell] = player.mark;
  const result = evaluateBoard(state.board);
  if (result.winner !== Empty) {
    state.status = "finished";
    state.winner = result.winner;
    state.winningLine = result.line;
    state.turnDeadline = 0;
    updateStats(logger, nk, state);
  } else if (isDraw(state.board)) {
    state.status = "finished";
    state.winner = "draw";
    state.turnDeadline = 0;
    updateStats(logger, nk, state);
  } else {
    state.turn = state.turn === X ? O : X;
    state.turnDeadline = state.timed ? tick + TurnSeconds : 0;
  }

  broadcastState(dispatcher, state, tick);
}

function handleRematch(dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, message: nkruntime.MatchMessage) {
  const player = playerForPresence(state, message.sender.userId);
  if (!player || state.status !== "finished") {
    return;
  }
  state.rematchRequested[player.userId] = true;
  if (state.players.length === 2 && state.rematchRequested[state.players[0].userId] && state.rematchRequested[state.players[1].userId]) {
    state.board = [Empty, Empty, Empty, Empty, Empty, Empty, Empty, Empty, Empty];
    state.turn = X;
    state.winner = Empty;
    state.winningLine = [];
    state.status = "playing";
    state.turnDeadline = state.timed ? tick + TurnSeconds : 0;
    state.rematchRequested = {};
    dispatcher.broadcastMessage(OpNotice, JSON.stringify({ message: "Both players accepted. Rematch started." }));
  } else {
    dispatcher.broadcastMessage(OpNotice, JSON.stringify({ message: player.username + " requested a rematch." }));
  }
  broadcastState(dispatcher, state, tick);
}

function finishByForfeit(nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: GameState, loserId: string, reason: string) {
  const loser = playerById(state, loserId);
  if (!loser) {
    return;
  }
  const winner = state.players[0].userId === loserId ? state.players[1] : state.players[0];
  state.status = "finished";
  state.winner = winner.mark;
  state.turnDeadline = 0;
  state.disconnectDeadlines = {};
  dispatcher.broadcastMessage(OpNotice, JSON.stringify({ message: loser.username + " forfeited by " + reason + "." }));
  updateStats(null, nk, state);
  broadcastState(dispatcher, state, tick);
}

function broadcastState(dispatcher: nkruntime.MatchDispatcher, state: GameState, tick: number) {
  dispatcher.broadcastMessage(OpState, JSON.stringify(publicState(state, tick)));
}

function publicState(state: GameState, tick: number): Json {
  return {
    board: state.board,
    turn: state.turn,
    winner: state.winner,
    winningLine: state.winningLine,
    status: state.status,
    timed: state.timed,
    remainingSeconds: state.timed && state.turnDeadline > 0 ? Math.max(0, state.turnDeadline - tick) : null,
    players: state.players.map(function (player) {
      return {
        userId: player.userId,
        username: player.username,
        mark: player.mark,
        connected: player.connected
      };
    }),
    spectators: state.spectators.length,
    rematchRequested: state.rematchRequested
  };
}

function evaluateBoard(board: string[]): { winner: string; line: number[] } {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
  ];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const value = board[line[0]];
    if (value !== Empty && value === board[line[1]] && value === board[line[2]]) {
      return { winner: value, line: line };
    }
  }

  return { winner: Empty, line: [] };
}

function updateStats(logger: nkruntime.Logger | null, nk: nkruntime.Nakama, state: GameState) {
  if (state.players.length !== 2) {
    return;
  }

  state.players.forEach(function (player) {
    const won = state.winner === player.mark;
    const lost = state.winner !== "draw" && state.winner !== player.mark;
    const stats = readStats(nk, player.userId);
    stats.wins += won ? 1 : 0;
    stats.losses += lost ? 1 : 0;
    stats.draws += state.winner === "draw" ? 1 : 0;
    stats.streak = won ? stats.streak + 1 : 0;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    writeStats(nk, player.userId, stats);
    nk.leaderboardRecordWrite("tic_tac_toe_wins", player.userId, player.username, stats.wins, stats.bestStreak, {
      losses: stats.losses,
      draws: stats.draws,
      streak: stats.streak
    });
  });

  if (logger) {
    logger.debug("stats updated for match");
  }
}

function readStats(nk: nkruntime.Nakama, userId: string): { wins: number; losses: number; draws: number; streak: number; bestStreak: number } {
  const defaults = { wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 };
  const rows = nk.storageRead([{ collection: "tic_tac_toe", key: "stats", userId: userId }]);
  if (rows.length === 0) {
    return defaults;
  }
  const value = rows[0].value as Record<string, number>;
  return {
    wins: Number(value.wins || 0),
    losses: Number(value.losses || 0),
    draws: Number(value.draws || 0),
    streak: Number(value.streak || 0),
    bestStreak: Number(value.bestStreak || 0)
  };
}

function writeStats(nk: nkruntime.Nakama, userId: string, stats: Json) {
  nk.storageWrite([
    {
      collection: "tic_tac_toe",
      key: "stats",
      userId: userId,
      value: stats,
      permissionRead: 2,
      permissionWrite: 0
    }
  ]);
}

function sendError(dispatcher: nkruntime.MatchDispatcher, presence: nkruntime.Presence, message: string) {
  dispatcher.broadcastMessage(OpNotice, JSON.stringify({ message: message }), [presence]);
}

function findPlayer(state: GameState, userId: string): number {
  for (let i = 0; i < state.players.length; i += 1) {
    if (state.players[i].userId === userId) {
      return i;
    }
  }
  return -1;
}

function playerForPresence(state: GameState, userId: string): PlayerState | null {
  const index = findPlayer(state, userId);
  return index >= 0 ? state.players[index] : null;
}

function playerById(state: GameState, userId: string): PlayerState | null {
  return playerForPresence(state, userId);
}

function currentPlayer(state: GameState): PlayerState | null {
  for (let i = 0; i < state.players.length; i += 1) {
    if (state.players[i].mark === state.turn) {
      return state.players[i];
    }
  }
  return null;
}

function removeSpectator(state: GameState, userId: string) {
  state.spectators = state.spectators.filter(function (presence) {
    return presence.userId !== userId;
  });
}

function isDraw(board: string[]): boolean {
  return board.every(function (cell) {
    return cell !== Empty;
  });
}

function displayName(presence: nkruntime.Presence): string {
  return presence.username || "Player";
}

function parseJson(payload: string): Json {
  if (!payload) {
    return {};
  }
  try {
    return JSON.parse(payload);
  } catch (_error) {
    return {};
  }
}
