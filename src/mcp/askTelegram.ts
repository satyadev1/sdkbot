import type { AppEnv } from '../config/env.js';
import type { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { escapeHtml, postTelegramMessage } from '../telegram/sendMessage.js';

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AskTelegramDeps = {
  env: AppEnv;
  repo: TelegramAnswersRepository;
  post?: typeof postTelegramMessage;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export type AskTelegramResult =
  | { answered: true; answer: string }
  | { answered: false; reason: 'timed_out' };

export async function askTelegram(
  sessionId: string,
  question: string,
  deps: AskTelegramDeps,
): Promise<AskTelegramResult> {
  const { env, repo } = deps;
  const post = deps.post ?? postTelegramMessage;
  const sleepFn = deps.sleep ?? sleep;
  const timeoutMs = deps.timeoutMs ?? 25 * 60 * 60 * 1000; // under the ~28h MCP tool ceiling

  if (!env.telegramBotToken || !env.telegramChatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set to use ask_telegram');
  }

  const text =
    `🟠 <b>Claude Code question</b>\n` +
    `<code>${escapeHtml(sessionId)}</code>\n\n` +
    `${escapeHtml(question)}\n\n` +
    `Reply to this message to answer.`;

  const row = await repo.create({ sessionId, question });
  const messageId = await post(env.telegramBotToken, env.telegramChatId, text, { html: true });
  await repo.setMessageId(row.id, messageId);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = await repo.findLatestForSession(sessionId);
    if (latest?.id === row.id && latest.status === 'answered') {
      return { answered: true, answer: latest.answer ?? '' };
    }
    if (Date.now() >= deadline) {
      return { answered: false, reason: 'timed_out' };
    }
    await sleepFn(POLL_INTERVAL_MS);
  }
}
