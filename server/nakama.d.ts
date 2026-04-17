declare namespace nkruntime {
  interface Context {
    userId: string;
    username: string;
  }

  interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  }

  interface Initializer {
    registerMatch<T>(name: string, handler: MatchHandler<T>): void;
    registerMatchmakerMatched(fn: MatchmakerMatchedFunction): void;
    registerRpc(name: string, fn: RpcFunction): void;
  }

  interface Presence {
    userId: string;
    sessionId: string;
    username: string;
    node: string;
  }

  interface MatchMessage {
    sender: Presence;
    opCode: number;
    data: Uint8Array;
  }

  interface MatchDispatcher {
    broadcastMessage(opCode: number, data: string | Uint8Array, presences?: Presence[] | null, sender?: Presence | null, reliable?: boolean): void;
    matchLabelUpdate(label: string): void;
  }

  interface MatchInitResult<T> {
    state: T;
    tickRate: number;
    label: string;
  }

  interface MatchJoinAttemptResult<T> {
    state: T;
    accept: boolean;
    rejectMessage?: string;
  }

  interface MatchStateResult<T> {
    state: T;
  }

  interface MatchSignalResult<T> {
    state: T;
    data: string;
  }

  interface MatchHandler<T> {
    matchInit(ctx: Context, logger: Logger, nk: Nakama, params: Record<string, unknown>): MatchInitResult<T>;
    matchJoinAttempt(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, presence: Presence, metadata: Record<string, string>): MatchJoinAttemptResult<T>;
    matchJoin(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, presences: Presence[]): MatchStateResult<T>;
    matchLeave(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, presences: Presence[]): MatchStateResult<T>;
    matchLoop(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, messages: MatchMessage[]): MatchStateResult<T> | null;
    matchTerminate(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, graceSeconds: number): MatchStateResult<T>;
    matchSignal(ctx: Context, logger: Logger, nk: Nakama, dispatcher: MatchDispatcher, tick: number, state: T, data: string): MatchSignalResult<T>;
  }

  type RpcFunction = (ctx: Context, logger: Logger, nk: Nakama, payload: string) => string;
  type MatchmakerMatchedFunction = (ctx: Context, logger: Logger, nk: Nakama, matched: MatchmakerResult[]) => string | null;

  interface MatchmakerResult {
    presence: Presence;
    properties?: Record<string, string>;
    numericProperties?: Record<string, number>;
  }

  interface MatchListEntry {
    matchId: string;
    size: number;
    label: string;
  }

  interface StorageReadRequest {
    collection: string;
    key: string;
    userId: string;
  }

  interface StorageWriteRequest {
    collection: string;
    key: string;
    userId: string;
    value: Record<string, unknown>;
    permissionRead: number;
    permissionWrite: number;
  }

  interface StorageObject {
    value: Record<string, unknown>;
  }

  interface Nakama {
    binaryToString(data: Uint8Array): string;
    leaderboardCreate(id: string, authoritative: boolean, sortOrder: string, operator: string, resetSchedule: string, metadata?: Record<string, unknown>): void;
    leaderboardRecordWrite(id: string, ownerId: string, username: string, score: number, subscore: number, metadata?: Record<string, unknown>): void;
    matchCreate(module: string, params?: Record<string, unknown>): string;
    matchList(limit: number, authoritative?: boolean, label?: string, minSize?: number, maxSize?: number, query?: string): MatchListEntry[];
    storageRead(requests: StorageReadRequest[]): StorageObject[];
    storageWrite(requests: StorageWriteRequest[]): void;
  }
}
