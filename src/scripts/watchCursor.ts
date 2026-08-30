import { loadEnv } from '../config/env.js';
import { startCursorWatcher } from '../cursor/watcher.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { mentionConfigFromEnv, shouldMention } from '../slack/mention.js';

async function main() {
  const env = loadEnv();
  if (!env.slackBotToken || !env.slackChannelId) {
    console.error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set to watch Cursor questions');
    process.exit(1);
  }

  const mention = mentionConfigFromEnv(env);
  if (mention.enabled && !mention.userId) {
    // Easy to get wrong and invisible in the output, so say so loudly.
    console.warn('SLACK_MENTION_USER_ID is unset — posts will not tag anyone');
  }

  const pool = getPool();
  const repo = new SlackAnswersRepository(pool);
  const watcher = startCursorWatcher({
    repo,
    botToken: env.slackBotToken,
    channelId: env.slackChannelId,
    mention,
  });

  const shutdown = () => {
    watcher.stop();
    void pool.end().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const tagging = shouldMention(mention, 'question')
    ? `tagging <@${mention.userId}> (scope: ${mention.scope})`
    : 'not tagging anyone';
  console.log(`sdkbot Cursor question watcher started — ${tagging}`);
}

main().catch((err) => {
  console.error('watchCursor failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
