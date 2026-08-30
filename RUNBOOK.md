# Slack two-way bridge — runbook

## What's running

Three independent pieces:

1. **Claude Code hooks** (`~/.claude/hooks/slack-notify.sh`, global, all sessions)
   Fire on `Stop`, `Notification`, and `AskUserQuestion` (`PreToolUse`). Post
   to Slack directly — no daemon needed, always works as long as Claude
   Code runs the hook.

2. **Slack bridge** (`sdkbot`, managed by launchd)
   Long-running Socket Mode process. Required only to *record thread
   replies* (i.e. for `wait-answer` to work). If it's down, questions still
   post to Slack fine — replies just won't be captured until it's back up.
   - launchd label: `com.sdkbot.slackbridge`
   - plist: `~/Library/LaunchAgents/com.sdkbot.slackbridge.plist`
   - entrypoint: `scripts/run-bridge.sh` (sources `.env`, execs `tsx src/scripts/bridge.ts`)
   - logs: `~/Library/Logs/sdkbot-slackbridge.log` / `.error.log`
   - `RunAtLoad` + `KeepAlive` → starts on login, restarts on crash

3. **Cursor question watcher** (`sdkbot`, managed by launchd)
   Cursor has no equivalent of a `PreToolUse` hook, so questions cannot be
   pushed. Instead this polls Cursor's chat store for an `ask_question` that
   is still unanswered and posts it. Read-only (`immutable=1`), so it never
   locks the live Cursor session.
   - launchd label: `com.sdkbot.cursorwatcher`
   - entrypoint: `scripts/run-cursor-watcher.sh` → `tsx src/scripts/watchCursor.ts`
   - Cursor messages are prefixed `{CURSOR}` to tell them apart in Slack

## Check status

```bash
launchctl print gui/$(id -u)/com.sdkbot.slackbridge | grep state
tail -20 ~/Library/Logs/sdkbot-slackbridge.log
tail -20 ~/Library/Logs/sdkbot-slackbridge.error.log
```

Healthy state: `state = running` and the log ends with
`sdkbot Slack bridge connected (Socket Mode)`.

## Restart it manually

```bash
launchctl kickstart -k gui/$(id -u)/com.sdkbot.slackbridge
```

## Stop / start / unload entirely

```bash
launchctl bootout gui/$(id -u)/com.sdkbot.slackbridge      # stop, don't restart
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sdkbot.slackbridge.plist  # (re)load
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No message in Slack at all | Webhook (`Stop`) or bot token (`Notification`/`AskUserQuestion`) misconfigured | Check `SLACK_WEBHOOK_URL` / `SLACK_BOT_TOKEN` in `.env`; test with `curl` (see below) |
| Message posts but no threading / can't reply | Using webhook fallback because `SLACK_BOT_TOKEN`/`SLACK_CHANNEL_ID` unset | Fill in `.env`, restart the bridge |
| `wait-answer` never returns even after replying | Bridge is down | `launchctl print gui/$(id -u)/com.sdkbot.slackbridge` — if not `running`, kickstart it |
| Bridge logs `missing_scope` | Bot token lacks `chat:write` (or other required scope) | Slack app → OAuth & Permissions → add scope → **Reinstall to Workspace** (must fully complete — verify with `auth.test`, see below) |
| Bridge logs `channel_not_found` | Bot not invited to the channel | In Slack: `/invite @<bot-name>` in the target channel |
| `.env` changed but bridge still uses old values | launchd process still running old env | `launchctl kickstart -k gui/$(id -u)/com.sdkbot.slackbridge` |
| Posts appear but don't notify you | `SLACK_MENTION_USER_ID` unset, or set to a display name / username instead of a `U...` member id | Copy the member id from your Slack profile; restart the watcher |
| Bridge's thread ack seems missing | Slack doesn't notify for an untagged bot reply — it posts quietly | Expand the thread; verify with `conversations.replies` |
| `deliver-answer` says "not a known terminal" | Focus moved to a browser or another app | Focus the terminal; it retries and delivers when focus returns |
| `deliver-answer` exits on Accessibility | `DELIVER_MODE=keystroke` without the grant | System Settings → Privacy & Security → Accessibility → enable your terminal, or use `clipboard` |
| `deliver-answer` waits forever | The row is still `pending` — answered in the terminal, or never answered in Slack | Check `slack_answers` (see "Known gap" above) |

### Verify bot token scopes live

```bash
curl -sSD - -o /dev/null -X POST -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
  https://slack.com/api/auth.test | grep -i x-oauth-scopes
```

Should include `chat:write`. If it only shows `incoming-webhook`, the
scope change hasn't actually been installed yet — go back to the Slack app
and click **Reinstall to Workspace** again.

### Manually test posting a question

```bash
set -a && source .env && set +a
npx tsx src/scripts/notifyQuestion.ts "testSession" "Does this work?"
```

### Manually test waiting for an answer

```bash
set -a && source .env && set +a
npx tsx src/scripts/waitForAnswer.ts "testSession"
```

Reply in the Slack thread; it should print the reply text and exit 0.

## Getting a Slack reply back into the session

Recording a reply is automatic; putting it into a waiting prompt is not.

```
you reply in the Slack thread
  -> bridge records it in slack_answers        automatic
  -> "1" resolves to the option label          automatic
  -> bridge acks in the thread                 automatic
  -> lands in the AskUserQuestion prompt       no path — see below
```

`AskUserQuestion` blocks on the terminal UI and consults no file, hook, or
API, so no external process can inject into it. Cursor's `ask_question` is
the same. Three ways to bridge that last step, none automatic:

| How | Command | Notes |
|---|---|---|
| Type it yourself | — | The reply is still recorded in Slack either way |
| Clipboard | `npm run deliver-answer -- <session-id>` | Copies the answer; press Cmd-V. No permission needed |
| Keystroke | same, with `DELIVER_MODE=keystroke` | Pastes it for you; needs Accessibility access |
| Print it | `npm run wait-answer -- <session-id>` | Blocks, prints the answer to stdout, exits 0 |

`deliver-answer` refuses to act unless the frontmost app is a recognised
terminal (or `DELIVER_EXPECTED_APP`), and refuses answers that are empty,
multi-line, over 500 chars, or contain control characters — it types into
whatever has focus, so a multi-line answer would submit early and leave the
rest as a second input. It does not press Return unless `DELIVER_SUBMIT=true`.

**Known gap:** a question you answer in the terminal instead of Slack stays
`pending` in `slack_answers` forever — nothing closes it. `deliver-answer`
will keep waiting on such a row. Inspect with:

```bash
psql "$DATABASE_URL" -c "select created_at, status, answer from slack_answers order by created_at desc limit 5;"
```

## Env vars (`sdkbot/.env`)

- `SLACK_WEBHOOK_URL` — used for the `Stop` hook (unthreaded, always works)
- `SLACK_BOT_TOKEN` (`xoxb-...`) — needed for threaded questions + bridge
- `SLACK_APP_TOKEN` (`xapp-...`) — needed for Socket Mode (bridge only)
- `SLACK_CHANNEL_ID` (`C...`) — channel the bridge posts into / listens on

@-mentions — Slack only notifies on a member id; a display name or username
is inert text:

- `SLACK_MENTION_USER_ID` (`U...`) — your member id (avatar → Profile → `...`
  → Copy member ID). Without it nothing is tagged, whatever else is set.
- `SLACK_MENTION_ENABLED` — master switch; defaults to on once an id is set
- `SLACK_MENTION_SCOPE` — `questions` (default) tags only posts awaiting an
  answer; `all` tags every post

Answer delivery (`deliver-answer`):

- `DELIVER_MODE` — `clipboard` (default) or `keystroke`
- `DELIVER_EXPECTED_APP` — bundle id that must be frontmost; empty = any
  recognised terminal
- `DELIVER_SUBMIT` — press Return after delivering; off by default

All three Slack tokens live only in `.env` (gitignored) — never commit them
or put real values in `.env.example`.
