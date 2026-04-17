# Multiplayer Tic-Tac-Toe with Nakama

Server-authoritative multiplayer Tic-Tac-Toe built with React, Vite, and Nakama authoritative multiplayer. The browser never decides whether a move is valid; it only sends intents to the Nakama match runtime, which validates turns, applies state, detects wins, updates leaderboard records, and broadcasts the result.

## Features

- Real-time multiplayer over Nakama sockets
- Create room, discover open rooms, join by room id, and automatic matchmaking
- Server-authoritative move validation and isolated match state
- Graceful disconnect handling with countdown forfeit
- Optional 30-second timed mode
- Automatic timeout forfeit in timed mode
- Rematch flow after a finished game
- Persistent win/loss/streak leaderboard via Nakama storage and leaderboard APIs
- Win/loss/draw toast feedback
- Responsive mobile-first web UI

## Tech Stack

- Frontend: React, TypeScript, Vite
- Multiplayer/backend: Nakama authoritative JavaScript runtime
- Database: Postgres
- Local orchestration: Docker Compose
- Deployment target: cloud VM/container for Nakama and Vercel/Netlify for frontend

## Project Structure

```text
.
├── docker-compose.yml          # Local Nakama + Postgres stack
├── package.json                # Frontend/build scripts and dependencies
├── index.html                  # Vite HTML entry
├── src/
│   ├── App.tsx                 # Main game UI
│   ├── nakama.ts               # Nakama client/socket/RPC integration
│   ├── styles.css              # Responsive styling
│   ├── types.ts                # Shared frontend TypeScript types
│   └── vite-env.d.ts           # Vite env typings
└── server/
    ├── main.ts                 # Nakama authoritative match runtime
    ├── nakama.d.ts             # Local Nakama runtime type declarations
    └── tsconfig.json           # Compiles server/main.ts to server/build/main.js
```

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the Nakama runtime module:

   ```bash
   npm run nakama:build
   ```

3. Start Nakama and Postgres:

   ```bash
   docker compose up --build
   ```

4. In a second terminal, start the web app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:5173`.

Docker is required for local Nakama. If Docker is not available locally, deploy the `server` runtime to a managed VM/container and point the frontend environment variables at that host.

## Deployment

### Nakama on a cloud VM

1. Create a Linux VM on AWS, GCP, Azure, DigitalOcean, or another provider.
2. Install Docker and Docker Compose.
3. Copy this repository to the VM.
4. Set strong production values in `docker-compose.yml` for `socket.server_key`, database passwords, and console credentials.
5. Build the runtime and start the stack:

   ```bash
   npm install
   npm run nakama:build
   docker compose up -d --build
   ```

6. Expose ports `7350` for the client API and `7351` for the Nakama console only from trusted IPs.
7. Configure TLS with a reverse proxy such as Caddy, Nginx, or a managed load balancer.

### Frontend on Vercel or Netlify

Set these environment variables in the hosting dashboard:

```bash
VITE_NAKAMA_SCHEME=https
VITE_NAKAMA_HOST=your-nakama.example.com
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SERVER_KEY=your_public_socket_key
```

Build command:

```bash
npm run build
```

Publish directory:

```bash
dist
```

After deployment, share the public frontend URL. The app will connect to the configured Nakama backend.

## Architecture

- `src/nakama.ts` owns authentication, socket connection, room RPCs, match joins, matchmaking, moves, and leaderboard reads.
- `src/App.tsx` renders the lobby, match status, board, timers, reconnect-friendly state, and leaderboard.
- `server/main.ts` registers authoritative RPCs and the `tic_tac_toe` Nakama match handler.
- `server/main.ts` is compiled to `server/build/main.js`, mounted into Nakama as runtime code.

### Design Decisions

- The server is authoritative. The frontend never writes the official board state directly.
- The client sends only move intent, and Nakama validates the move before applying it.
- Each game room is a separate Nakama authoritative match, so simultaneous games have isolated state.
- Room creation and room discovery use Nakama RPCs.
- Automatic matchmaking uses Nakama matchmaker tickets and the runtime `matchmakerMatched` hook.
- Classic and timed matchmaking are separated by a `timed` matchmaking property.
- Timed mode stores a server-side turn deadline and broadcasts countdown state every tick.
- Player performance is persisted through Nakama storage and Nakama leaderboard records.

## API and Server Configuration

### Frontend Environment Variables

Local development:

```bash
VITE_NAKAMA_SCHEME=http
VITE_NAKAMA_HOST=127.0.0.1
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_SERVER_KEY=defaultkey
```

Production example:

```bash
VITE_NAKAMA_SCHEME=https
VITE_NAKAMA_HOST=your-nakama-domain.com
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SERVER_KEY=your-production-socket-key
```

### Nakama RPCs

- `create_match`: creates a new authoritative Tic-Tac-Toe room
- `list_matches`: lists open rooms for the selected mode

### Docker Services

`docker-compose.yml` starts:

- `postgres`: Nakama database
- `nakama`: Nakama server with the compiled runtime loaded from `server/build/main.js`

Important Nakama runtime flags:

```bash
--runtime.path /nakama/data/modules
--runtime.js_entrypoint main.js
--socket.server_key defaultkey
```

## Runtime Opcodes

- `1`: server state broadcast
- `2`: client move request
- `3`: chat/status message

## How to Test Multiplayer Functionality

### Manual Room Test

1. Open `http://localhost:5173` in browser tab 1.
2. Click `Connect`.
3. Click `Create`.
4. Copy the room id from the room input.
5. Open `http://localhost:5173` in browser tab 2 or another browser profile.
6. Click `Connect`.
7. Paste the room id.
8. Click `Join`.
9. Confirm one player is `X` and the other is `O`.
10. Play moves and verify turns alternate.
11. Finish the game and confirm win/loss/draw toast appears.
12. Confirm leaderboard updates after the match.

### Matchmaking Test

1. Open two browser tabs or two browser profiles.
2. In both, select the same mode: `Classic` or `30s turns`.
3. In both, click `Connect`.
4. In both, click `Matchmake`.
5. Confirm Nakama pairs both players into one game.

### Timed Mode Test

1. Select `30s turns`.
2. Create/join or matchmake.
3. Confirm the countdown displays `30, 29, 28...`.
4. Let the timer reach zero.
5. Confirm the current player loses by timeout.

### Rematch Test

1. Finish a match.
2. Player 1 clicks `Request rematch`.
3. Confirm both players see rematch feedback.
4. Player 2 clicks `Request rematch`.
5. Confirm the board resets and a new game starts.

## Production Notes

- Keep the server key out of public source if you use a privileged key. Nakama's default socket key is public-facing by design, but use a unique value per environment.
- Use HTTPS/WSS in production.
- Restrict the Nakama console.
- Consider Redis and a managed Postgres service for larger deployments.
- Change local default passwords before production deployment.
- Use a managed Postgres database for larger production deployments.
