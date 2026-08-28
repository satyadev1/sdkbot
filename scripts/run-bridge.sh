#!/usr/bin/env bash
# Launchd entrypoint: sources .env (this project loads no dotenv itself),
# then execs the bridge so it inherits Slack/DB env vars.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a
exec ./node_modules/.bin/tsx src/scripts/bridge.ts
