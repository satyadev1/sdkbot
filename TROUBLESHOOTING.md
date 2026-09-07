# Troubleshooting — known failure patterns

Root-level on purpose: any agent working in this repo should find this
before re-diagnosing an issue that's already been hit and fixed before.
Covers recurring/systemic failures across the Slack and Telegram
integrations. For Slack-specific day-to-day ops, see `RUNBOOK.md`.

## Quick triage

```bash
launchctl list | grep sdkbot
```

Every row should show exit status `0` in the second column. All five
services should be present:

- `com.sdkbot.slackbridge`
- `com.sdkbot.telegrambridge`
- `com.sdkbot.cursorwatcher`
- `com.sdkbot.cursorwatcher.telegram`
- `com.sdkbot.watchdog` — self-heal; see below

If a label is missing entirely, it's not loaded — see "Service isn't
loaded at all" below.

**Check the watchdog first.** `com.sdkbot.watchdog` runs every 300s and
already auto-heals the three most common failures (hung bridge, stopped
Postgres container, service missing from launchctl), alerting to Telegram
and Slack whenever it acts.

Every alert ends with a **"What you should do"** section — read that first.
Most alerts are *already healed* and say "Nothing"; only the ones that say
"Needs you" require action, and they include the exact commands to run. So
an alert arriving is not by itself a reason to intervene.

It is silent when healthy, so its log is the fastest way to see whether
something already broke and was fixed:

```bash
tail -30 ~/Library/Logs/sdkbot-watchdog.log
```

If the DB is down, note `sdkbot-db-1`'s `restart: unless-stopped` does
**not** survive the Docker daemon itself restarting — that's what the
watchdog's `docker start` check exists for.

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

**Cause (confirmed root cause of the recurring "Telegram is always
failing" reports): a silent `fetch()` hang, not a crash.** Intermittent
network/DNS failures can prevent resolution of `api.telegram.org` and
drop idle 30s long-poll connections — the log showed hundreds of
`getaddrinfo ENOTFOUND api.telegram.org`. Node's `fetch()`
had **no timeout**, so when a connection was dropped mid-flight the call
could block forever. Observed end state: the process alive for 21h at 0%
CPU, **no open socket**, and **no log output for 4+ hours**.

The reason this went undetected for days is that `launchd`'s `KeepAlive`
only restarts processes that have *died*. A process that is hung but
still alive looks perfectly healthy to it, so nothing ever restarted it,
and the bridge silently stopped receiving replies while appearing to run.

Three changes in `src/telegram/bridge.ts` + `scripts/watchdog.sh` address
this:
- `AbortSignal.timeout()` (`POLL_TIMEOUT_SECONDS` 30 + 15s slack = 45s)
  so a dead connection now throws instead of hanging forever.
- A heartbeat line every 5 minutes, so a healthy-but-idle bridge and a
  hung one are distinguishable — a stale log mtime is now unambiguous
  proof of a hang.
- `scripts/watchdog.sh` (launchd `com.sdkbot.watchdog`, every 300s) reads
  that heartbeat and restarts the bridge if it goes stale for >15m,
  alerting to both Telegram and Slack. This has since caught and healed a
  real hang unattended.

So a bare `fetch failed` loop that never recovers is a **network/DNS**
problem (check `err.cause`, see the log-detail note below), and total
silence with no heartbeat is a **hang** — the watchdog should now fix the
latter on its own within ~5 minutes.

**Secondary cause — 409 `Conflict` (a different failure, don't confuse
them):** Telegram's Bot API allows only **one** active `getUpdates`
long-poll per bot token. A second caller against the same token — a
duplicate process, or an ungracefully killed predecessor whose session
Telegram still considers active — gets:

```json
{"ok":false,"error_code":409,"description":"Conflict: terminated by other getUpdates request; make sure that only one bot instance is running"}
```

Unlike the hang, this one is loud: the log fills continuously rather than
going quiet. The retry loop cannot clear it on its own.

**⚠️ Do NOT diagnose with a manual `getUpdates` call while the bridge is
running.** Because of that single-session limit, a diagnostic
`curl`/script call — made specifically to check whether the bridge is
stuck — knocks the real, healthy bridge offline and forces it into its own
409 retry loop, i.e. the check *creates* the failure it was meant to
detect. Confirmed by direct reproduction: a standalone Node script hitting
`getUpdates` 5 times immediately produced a fresh `Conflict: terminated by
other getUpdates request` loop in the live bridge's log. Note this is a
self-inflicted diagnostic hazard, **not** the cause of the original
outage — that was the hang above.

**Diagnose safely** — use endpoints that don't touch the long-poll lock:
```bash
set -a; source .env; set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"          # token/network sanity, safe
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" # safe; non-empty url also breaks getUpdates (mutually exclusive) — clear with deleteWebhook if so
tail -f ~/Library/Logs/sdkbot-telegrambridge.log                          # passive; watch, don't poll getUpdates yourself
```
Only call `getUpdates` directly as a last resort when the bridge is
confirmed stopped (`launchctl unload` first) — never while it's running.

**Fix — if it's a hang** (no output at all, no recent `heartbeat:` line):
first just wait ~5 minutes; `com.sdkbot.watchdog` polls every 300s and
should restart it and alert you. Confirm it did:
```bash
tail -20 ~/Library/Logs/sdkbot-watchdog.log      # look for "heartbeat stale ... reloading"
launchctl list | awk '$3 == "com.sdkbot.watchdog"'   # must be present, else load the plist
```
If the watchdog itself isn't loaded or didn't act, reload the bridge by
hand with the steps below.

**Fix — if it's a 409 `Conflict` loop:**
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
