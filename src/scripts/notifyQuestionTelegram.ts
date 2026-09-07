import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { escapeHtml, postTelegramMessage } from '../telegram/sendMessage.js';

async function main() {
  const sessionId = process.argv[2] ?? '';
  const question = process.argv[3] ?? '';
  if (!sessionId || !question) {
    console.error('Usage: notifyQuestionTelegram.ts <session-id> <question> [label]');
    process.exit(1);
  }
  const label = process.argv[4] || `Claude Code (session ${sessionId})`;

  const env = loadEnv();
  if (!env.telegramBotToken || !env.telegramChatId) {
    console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set');
    process.exit(1);
  }

  const time = new Date().toLocaleString();
  const text =
    `🟠 <b>${escapeHtml(label)}</b>\n` +
    `<i>${escapeHtml(time)}</i>\n\n` +
    `${escapeHtml(question)}\n\n` +
    `Reply to this message to answer.`;

  // Recorded first so the bridge can match a reply back to this row even if
  // the reply lands before setMessageId returns.
  const pool = getPool();
  const repo = new TelegramAnswersRepository(pool);
  const row = await repo.create({ sessionId, question });
  const messageId = await postTelegramMessage(env.telegramBotToken, env.telegramChatId, text, {
    html: true,
  });
  await repo.setMessageId(row.id, messageId);
  await pool.end();
}

main().catch((err) => {
  console.error('notifyQuestionTelegram failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
