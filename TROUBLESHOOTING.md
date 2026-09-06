# Troubleshooting — known failure patterns

Root-level on purpose: any agent working in this repo should find this
before re-diagnosing an issue that's already been hit and fixed before.
Covers recurring/systemic failures across the Slack and Telegram
integrations. For Slack-specific day-to-day ops, see `RUNBOOK.md`.

## Quick triage

```bash
launchctl list | grep sdkbot
```

Every row should show exit status `0` in the second column. All four
services should be present:

- `com.sdkbot.slackbridge`
- `com.sdkbot.telegrambridge`
- `com.sdkbot.cursorwatcher`
- `com.sdkbot.cursorwatcher.telegram`

If a label is missing entirely, it's not loaded — see "Service isn't
loaded at all" below.

```bash
tail -30 ~/Library/Logs/sdkbot-<service>.log
tail -30 ~/Library/Logs/sdkbot-<service>.error.log
```

Service name → log prefix: `slackbridge`, `telegrambridge`,
`cursorwatcher`, `cursorwatcher-telegram`.

## Issue: Cursor watcher logs `database disk image is malformed (11)`

**Symptom:** `watcher poll failed` / `telegram watcher poll failed`
repeating in the Slack and/or Telegram Cursor-watcher logs. Both watchers
read the same file, so this always affects both at once — if only one
channel seems affected, the cause is something else (check the other
sections below).

**Cause:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
is Cursor's live SQLite chat store, actively being written to while Cursor
is open. `PRAGMA integrity_check` can report `ok` a moment later — that's a
snapshot, not proof the file stays consistent between our reads. This is an
ongoing race between Cursor's writer and our reader, not a one-time
corruption event, and it comes back.

**Fix:**
1. Confirm it: `sqlite3 "file:$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb?immutable=1" "PRAGMA integrity_check;"`
2. Fully quit and reopen Cursor (checkpoints/rebuilds its SQLite state on
   clean startup).
3. Restart both watchers to clear stale in-memory DB handles — a clean DB
   doesn't help if the running process already has a bad handle open:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.sdkbot.cursorwatcher.plist
   launchctl unload ~/Library/LaunchAgents/com.sdkbot.cursorwatcher.telegram.plist
   launchctl load ~/Library/LaunchAgents/com.sdkbot.cursorwatcher.plist
   launchctl load ~/Library/LaunchAgents/com.sdkbot.cursorwatcher.telegram.plist
   ```
4. Confirm: both logs should show `watching ... (N question(s) already
   pending, ignored)` with no error lines after it.

**Note:** both watcher implementations already treat this as recoverable —
a failed poll is logged and skipped, not fatal (see `poll()` in
`src/cursor/watcher.ts` / `src/cursor/telegramWatcher.ts`). This is expected
background noise at low frequency; only escalate if it's constant/never
recovers between polls.

## Issue: Telegram bridge never receives replies — `getUpdates failed, retrying: fetch failed`

**Symptom:** `sdkbot-telegrambridge.log` fills with `getUpdates failed,
retrying: fetch failed` in a tight loop and never logs a successful
`connected` recovery. Network/DNS/curl checks against
`api.telegram.org` from the same machine succeed fine — the failure is
specific to the bridge's long-poll session, not general connectivity.

**Cause:** Telegram's Bot API allows only **one** active `getUpdates`
long-poll per bot token. If a previous bridge process was killed
ungracefully (plain `kill`/`SIGKILL` while a 30s long-poll was in flight,
a crash, a `launchctl unload` that didn't let it exit cleanly), Telegram's
server can keep that dead session "active" for a while. Every subsequent
call — including from a freshly restarted, perfectly healthy process —
gets rejected:

```json
{"ok":false,"error_code":409,"description":"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"}
```

The bridge's own retry loop (5s backoff, `src/telegram/bridge.ts`) cannot
fix this by itself — it keeps retrying against the same stuck lock
indefinitely; this can and did persist for days.

**⚠️ Do NOT diagnose with a manual `getUpdates` call while the bridge is
running.** This was the actual root cause behind repeated "it's always
failing" reports: `getUpdates` enforces a single active long-poll per bot
token, so a diagnostic `curl`/script call — made specifically to check
whether the bridge is stuck — knocks the real, healthy bridge process
offline and forces it into its own 409 retry loop. Confirmed by direct
reproduction: a standalone Node script hitting `getUpdates` 5 times
immediately produced a fresh `Conflict: terminated by other getUpdates
request` loop in the live bridge's log. Left completely alone (no external
`getUpdates` calls from anywhere), the bridge holds a stable connection
indefinitely.

**Diagnose safely** — use endpoints that don't touch the long-poll lock:
```bash
set -a; source .env; set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"          # token/network sanity, safe
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" # safe; non-empty url also breaks getUpdates (mutually exclusive) — clear with deleteWebhook if so
tail -f ~/Library/Logs/sdkbot-telegrambridge.log                          # passive; watch, don't poll getUpdates yourself
```
Only call `getUpdates` directly as a last resort when the bridge is
confirmed stopped (`launchctl unload` first) — never while it's running.

**Fix:**
1. Stop the bridge and confirm nothing else is running against the same
   token (see "duplicate process" issue below — that's the usual second
   cause of a stuck lock):
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.sdkbot.telegrambridge.plist
   ps aux | grep telegramBridge | grep -v grep   # should be empty
   ```
2. Wait ~15-30s for Telegram's server-side session to time out.
3. Verify the lock cleared: rerun the manual `getUpdates` curl above —
   expect `{"ok":true,"result":[]}`.
4. Reload: `launchctl load ~/Library/LaunchAgents/com.sdkbot.telegrambridge.plist`
5. Confirm via passive `tail -f` only (see warning above — do not run your
   own `getUpdates` call here). Log should show `sdkbot Telegram bridge
   connected (long-polling)` with no further `getUpdates failed` lines.
   Watch for at least 2-5 minutes to be sure.

**Note on log detail:** `src/telegram/bridge.ts` logs `err.cause` alongside
`err.message` (via `describeError()`), so a genuine network-level `fetch
failed` (DNS, ECONNRESET, timeout) now shows its real cause directly in the
log instead of just the opaque string `fetch failed`. If you see bare
`fetch failed` with no `(cause: ...)` suffix on a version after this fix,
something is stripping the cause — check the Node/undici version.

## Issue: duplicate/unmanaged process holding a bot token

**Symptom:** intermittent or permanent 409s as above, or generally
unexplained flakiness in a service that otherwise looks configured
correctly.

**Cause:** a process was started manually (`npm run <script>` in a
terminal, or an old compiled build under `dist/`) *in addition to* the
launchd-managed one, and never got cleaned up — both read the same `.env`
and fight over the same token/long-poll/connection.

**Diagnose:**
```bash
ps aux | grep -iE "telegram|tsx src/scripts" | grep -v grep
```
Look for more than one process per script, or any process whose `cwd` is
this repo running something other than the current `tsx src/scripts/*.ts`
entrypoints (e.g. `node dist/index.js` — a stale `tsc` build predating the
current script layout; check `ls dist/` and compare against `src/` to see
what it actually is before killing anything).

**Fix:** kill the unmanaged duplicate, keep only the launchd-managed one.
If a legitimate process (e.g. the `dist/index.js` scheduler, run via `npm
start`) is running unmanaged long-term, give it its own launchd plist
instead of leaving it as a bare background process — mirror
`com.sdkbot.telegrambridge.plist` (see below).

## Issue: service isn't loaded at all

**Symptom:** a label is simply missing from `launchctl list | grep
sdkbot`.

**Fix:** confirm the plist exists, then load it:
```bash
ls ~/Library/LaunchAgents/com.sdkbot.*.plist
launchctl load ~/Library/LaunchAgents/com.sdkbot.<service>.plist
```
If the plist itself doesn't exist yet, create one mirroring an existing
service (`com.sdkbot.slackbridge.plist` or `com.sdkbot.telegrambridge.plist`
are the simplest templates — `Label`, `ProgramArguments` pointing at a
`scripts/run-*.sh` wrapper that sources `.env` then execs the `tsx`
entrypoint, `RunAtLoad` + `KeepAlive` both `true`, log paths under
`~/Library/Logs/`).

## General debugging checklist

1. `launchctl list | grep sdkbot` — all four present, all exit status `0`?
2. Tail both `.log` and `.error.log` for the affected service.
3. Is the failure specific to one channel (Slack vs Telegram) or shared?
   Shared → almost certainly the Cursor `state.vscdb` issue above, since
   that's the one dependency both Cursor watchers have in common.
   Telegram-only, bridge-specific → almost certainly the `getUpdates` 409
   lock.
4. `ps aux | grep -iE "telegram|slack|cursorwatcher|tsx src/scripts"` —
   exactly one process per service, all owned by launchd (parent managed),
   none orphaned from a manual run.
5. For Telegram specifically: a raw `curl` to `getMe` / `getUpdates`
   against the real token isolates "is the token/network fine" from "is
   our process specifically stuck."
