# Slack two-way bridge — runbook

## What's running

Two independent pieces:

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

## Env vars (`sdkbot/.env`)

- `SLACK_WEBHOOK_URL` — used for the `Stop` hook (unthreaded, always works)
- `SLACK_BOT_TOKEN` (`xoxb-...`) — needed for threaded questions + bridge
- `SLACK_APP_TOKEN` (`xapp-...`) — needed for Socket Mode (bridge only)
- `SLACK_CHANNEL_ID` (`C...`) — channel the bridge posts into / listens on

All three Slack tokens live only in `.env` (gitignored) — never commit them
or put real values in `.env.example`.
