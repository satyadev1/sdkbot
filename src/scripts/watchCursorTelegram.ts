import { loadEnv } from '../config/env.js';
import { startCursorTelegramWatcher } from '../cursor/telegramWatcher.js';
import { getPool } from '../db/client.js';
import { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';

async function main() {
  const env = loadEnv();
  if (!env.telegramBotToken || !env.telegramChatId) {
    console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set to watch Cursor questions');
    process.exit(1);
  }

  const pool = getPool();
  const repo = new TelegramAnswersRepository(pool);
  const watcher = startCursorTelegramWatcher({
    repo,
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
  });

  const shutdown = () => {
    watcher.stop();
    void pool.end().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('sdkbot Cursor question watcher (Telegram) started');
}

main().catch((err) => {
  console.error('watchCursorTelegram failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
