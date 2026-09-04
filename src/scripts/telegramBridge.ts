import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { startTelegramBridge } from '../telegram/bridge.js';

const env = loadEnv();
if (!env.telegramBotToken) {
  console.error('TELEGRAM_BOT_TOKEN is not configured; cannot start the Telegram bridge.');
  process.exit(1);
}

const pool = getPool();
const repo = new TelegramAnswersRepository(pool);

console.log('sdkbot Telegram bridge connected (long-polling)');
await startTelegramBridge(env.telegramBotToken, repo);
