import { loadEnv } from '../config/env.js';
import { startCursorWatcher } from '../cursor/watcher.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';

async function main() {
  const env = loadEnv();
  if (!env.slackBotToken || !env.slackChannelId) {
    console.error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set to watch Cursor questions');
    process.exit(1);
  }

  const pool = getPool();
  const repo = new SlackAnswersRepository(pool);
  const watcher = startCursorWatcher({
    repo,
    botToken: env.slackBotToken,
    channelId: env.slackChannelId,
  });

  const shutdown = () => {
    watcher.stop();
    void pool.end().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('sdkbot Cursor question watcher started');
}

main().catch((err) => {
  console.error('watchCursor failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
