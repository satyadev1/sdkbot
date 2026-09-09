import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { startSlackBridge } from '../bridge/slackBridge.js';
import { runClaude } from '../claude/runClaude.js';

const env = loadEnv();
if (!env.slackAppToken) {
  console.error('SLACK_APP_TOKEN is not configured; cannot start the Slack bridge.');
  process.exit(1);
}

/**
 * Inbound commands need all three: the bot id to detect a mention, the allowed
 * sender, and a dedicated session id. Missing any one leaves the path off, so
 * an incomplete config cannot half-enable command execution.
 */
const commandConfig =
  env.slackBotUserId && env.slackMentionUserId && env.claudeBridgeSessionId
    ? {
        botUserId: env.slackBotUserId,
        allowedUserId: env.slackMentionUserId,
        sessionId: env.claudeBridgeSessionId,
      }
    : undefined;

// The first turn creates the session; later ones resume it so the bridge keeps
// context across messages. Only flipped after a turn actually succeeds —
// resuming a session that was never created would fail every subsequent call.
let sessionStarted = false;

const pool = getPool();
const repo = new SlackAnswersRepository(pool);
const client = startSlackBridge(env.slackAppToken, repo, {
  botToken: env.slackBotToken,
  command: commandConfig && {
    botUserId: commandConfig.botUserId,
    allowedUserId: commandConfig.allowedUserId,
    run: async (prompt) => {
      const outcome = await runClaude(prompt, {
        sessionId: commandConfig.sessionId,
        resume: sessionStarted,
      });
      if (outcome.ok) sessionStarted = true;
      return outcome;
    },
  },
});

await client.start();
const acking = env.slackBotToken ? 'acking replies in-thread' : 'no bot token — replies recorded silently';
const commands = commandConfig
  ? `commands enabled for ${commandConfig.allowedUserId} (read-only)`
  : 'commands disabled';
console.log(`sdkbot Slack bridge connected (Socket Mode) — ${acking}; ${commands}`);
