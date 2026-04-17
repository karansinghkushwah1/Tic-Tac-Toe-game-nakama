#!/bin/sh
set -eu

: "${DATABASE_ADDRESS:?DATABASE_ADDRESS is required. Use the Nakama format user:password@host:port/database}"

PORT="${PORT:-7350}"
NAKAMA_SERVER_KEY="${NAKAMA_SERVER_KEY:-defaultkey}"
NAKAMA_CONSOLE_USERNAME="${NAKAMA_CONSOLE_USERNAME:-admin}"
NAKAMA_CONSOLE_PASSWORD="${NAKAMA_CONSOLE_PASSWORD:-password}"

/nakama/nakama migrate up --database.address "$DATABASE_ADDRESS"

exec /nakama/nakama \
  --database.address "$DATABASE_ADDRESS" \
  --runtime.path /nakama/data/modules \
  --runtime.js_entrypoint main.js \
  --socket.server_key "$NAKAMA_SERVER_KEY" \
  --socket.port "$PORT" \
  --logger.level INFO \
  --session.token_expiry_sec 7200 \
  --console.username "$NAKAMA_CONSOLE_USERNAME" \
  --console.password "$NAKAMA_CONSOLE_PASSWORD"
