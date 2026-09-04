#!/usr/bin/env bash
# MCP entrypoint: sources .env (this project loads no dotenv itself), then
# execs the ask_slack server so it inherits Slack/DB env vars.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a
exec ./node_modules/.bin/tsx src/mcp/server.ts
