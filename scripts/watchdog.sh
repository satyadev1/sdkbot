#!/usr/bin/env bash
# Self-heal watchdog for sdkbot background services.
#
# Catches the failure modes launchd's KeepAlive cannot:
#   1. Bridge process alive but hung (0% CPU, no socket, no log output) — the
#      observed Telegram failure: 4h of silence while "running", so KeepAlive
#      never fires. Detected via a stale heartbeat in the log.
#   2. Postgres container stopped (restart: unless-stopped does not survive the
#      Docker daemon itself restarting) — breaks ask_slack/ask_telegram.
#   3. A service missing from launchctl entirely.
#
# Heals by reloading/restarting, then reports what it did to both channels.
# Run from cron/launchd every few minutes. Safe to run concurrently-ish: a
# lock file keeps two copies from fighting over the same restart.
set -uo pipefail

# Resolve the repo root from this script's own location, so the script is
# portable and carries no machine-specific path. Override with SDKBOT_DIR.
SDKBOT_DIR="${SDKBOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOG_DIR="$HOME/Library/Logs"
AGENTS_DIR="$HOME/Library/LaunchAgents"
WATCHDOG_LOG="$LOG_DIR/sdkbot-watchdog.log"
# Kept out of /tmp: that path is shared and predictable, so any other local
# process could pre-create it and silently suppress every future run. This
# directory is user-owned (700), so only we can create the lock.
LOCK_DIR="$HOME/Library/Caches/sdkbot"
LOCK="$LOCK_DIR/watchdog.lock"
mkdir -p "$LOCK_DIR" 2>/dev/null || true
chmod 700 "$LOCK_DIR" 2>/dev/null || true

# Heartbeat is every 5m; allow two misses before calling it hung.
STALE_AFTER_SECONDS="${SDKBOT_STALE_AFTER_SECONDS:-900}"

# macOS has no flock(1), so use mkdir as the atomic primitive. A lock older
# than 10m is stale (a previous run died mid-restart) and gets reclaimed.
if ! mkdir "$LOCK" 2>/dev/null; then
  lock_mtime="$(stat -f %m "$LOCK" 2>/dev/null || echo 0)"
  if [ "$(( $(date +%s) - lock_mtime ))" -gt 600 ]; then
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT INT TERM

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$WATCHDOG_LOG"; }

# --- credentials (best effort; alerting is optional) ----------------------
BOT_TOKEN=""; CHAT_ID=""; SLACK_WEBHOOK=""
if [ -f "$SDKBOT_DIR/.env" ]; then
  eval "$(
    set -a; . "$SDKBOT_DIR/.env" 2>/dev/null; set +a
    printf 'BOT_TOKEN=%q\nCHAT_ID=%q\nSLACK_WEBHOOK=%q\n' \
      "${TELEGRAM_BOT_TOKEN:-}" "${TELEGRAM_CHAT_ID:-}" "${SLACK_WEBHOOK_URL:-}"
  )"
fi

esc_html() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

# alert <what-happened> [what-you-should-do]
# The second arg matters: an alert that only says what broke leaves the reader
# guessing whether they need to act at all. Most of these are already self-
# healed, so say so explicitly rather than implying an emergency.
alert() {
  local msg="$1" action="${2:-No action needed — already handled automatically.}"
  say "ALERT: $msg | ACTION: $action"
  if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
    curl -sS --max-time 15 -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -H 'Content-Type: application/json' \
      -d "$(jq -n --arg c "$CHAT_ID" --arg t "🔧 <b>sdkbot watchdog</b>
$(esc_html "$msg")

<b>What you should do:</b>
$(esc_html "$action")" '{chat_id:$c, text:$t, parse_mode:"HTML"}')" >/dev/null 2>&1 || true
  fi
  if [ -n "$SLACK_WEBHOOK" ]; then
    curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
      -d "$(jq -n --arg t ":wrench: *sdkbot watchdog*
$msg

*What you should do:*
$action" '{text:$t}')" "$SLACK_WEBHOOK" >/dev/null 2>&1 || true
  fi
}

# Exact-match: "com.sdkbot.cursorwatcher" is a prefix of
# "com.sdkbot.cursorwatcher.telegram", so a substring grep cross-matches them.
is_loaded() {
  launchctl list | awk -v l="$1" '$3 == l {found=1} END {exit !found}'
}

reload_service() {
  local label="$1" plist="$AGENTS_DIR/$1.plist"
  [ -f "$plist" ] || { say "no plist for $label"; return 1; }
  launchctl unload "$plist" >/dev/null 2>&1
  sleep 3
  launchctl load "$plist" >/dev/null 2>&1
  # launchd registers asynchronously; poll rather than assume one sleep is enough.
  local i=0
  while [ "$i" -lt 10 ]; do
    is_loaded "$label" && return 0
    sleep 1
    i=$(( i + 1 ))
  done
  return 1
}

age_seconds() {
  local f="$1"
  [ -f "$f" ] || { echo 999999; return; }
  local m; m="$(stat -f %m "$f" 2>/dev/null || echo 0)"
  echo $(( $(date +%s) - m ))
}

# --- 1. postgres container ------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^sdkbot-db-1$'; then
    :
  elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^sdkbot-db-1$'; then
    say "sdkbot-db-1 not running; starting"
    if docker start sdkbot-db-1 >/dev/null 2>&1; then
      alert "Postgres (sdkbot-db-1) was stopped — restarted it. ask_slack/ask_telegram were failing until now." \
        "Nothing right now — it's back up. If you see this often, the Docker daemon is restarting (an update or a reboot); 'restart: unless-stopped' does not survive that. Ask Claude to make the DB start on login if it becomes a habit."
    else
      alert "Postgres (sdkbot-db-1) is stopped and would NOT start. Claude Code questions cannot be recorded." \
        "Needs you. Check Docker Desktop is running, then: docker start sdkbot-db-1 && docker logs --tail 50 sdkbot-db-1. Until it's up, questions won't reach Slack or Telegram."
    fi
  fi
fi

# --- 2. services present + not hung --------------------------------------
# label:logfile — logfile is the heartbeat source, "-" to only check presence.
SERVICES="
com.sdkbot.telegrambridge:sdkbot-telegrambridge.log
com.sdkbot.slackbridge:-
com.sdkbot.cursorwatcher:-
com.sdkbot.cursorwatcher.telegram:-
"

for entry in $SERVICES; do
  label="${entry%%:*}"; logname="${entry##*:}"

  if ! is_loaded "$label"; then
    say "$label missing from launchctl; loading"
    if reload_service "$label"; then
      alert "$label was not loaded — loaded it." \
        "Nothing — it's running again. Usually means a reboot or a manual 'launchctl unload'."
    else
      alert "$label is not loaded and failed to load. Needs manual attention." \
        "Needs you. Run: launchctl load ~/Library/LaunchAgents/$label.plist ; then check ~/Library/Logs/ for that service's .error.log. This service stays dead until fixed."
    fi
    continue
  fi

  [ "$logname" = "-" ] && continue

  age="$(age_seconds "$LOG_DIR/$logname")"
  if [ "$age" -gt "$STALE_AFTER_SECONDS" ]; then
    say "$label heartbeat stale (${age}s > ${STALE_AFTER_SECONDS}s); reloading"
    if reload_service "$label"; then
      alert "$label was hung (no heartbeat for $((age / 60))m, process alive but idle) — restarted it. Replies were not being received until now." \
        "Nothing — it's fixed and replies work again. If a question went unanswered during that window, send it again. Frequent repeats usually mean flaky network/DNS to api.telegram.org rather than a code fault."
    else
      alert "$label was hung and failed to restart cleanly. Needs manual attention." \
        "Needs you. Run: launchctl unload ~/Library/LaunchAgents/$label.plist && sleep 5 && launchctl load ~/Library/LaunchAgents/$label.plist ; then: tail -30 ~/Library/Logs/$logname. Replies stay broken until this comes back."
    fi
  fi
done

exit 0
