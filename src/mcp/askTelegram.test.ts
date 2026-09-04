import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import type { TelegramAnswer } from '../db/telegramAnswersRepository.js';
import { askTelegram } from './askTelegram.js';

const DB = 'postgres://u:p@localhost:5432/db';

function envWith(over: Record<string, string> = {}) {
  return loadEnv({
    DATABASE_URL: DB,
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: '555',
    ...over,
  });
}

function harness(opts: { answerAfterPolls?: number } = {}) {
  const rows = new Map<string, TelegramAnswer>();
  let polls = 0;
  const posted: Array<{ token: string; chatId: string; text: string }> = [];
  const slept: number[] = [];

  const repo = {
    create: async (input: { sessionId: string; question?: string | null }) => {
      const row: TelegramAnswer = {
        id: 'row-1',
        sessionId: input.sessionId,
        messageId: null,
        question: input.question ?? null,
        answer: null,
        status: 'pending',
        dedupeKey: null,
        createdAt: new Date(),
        answeredAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    setMessageId: async (id: string, messageId: number) => {
      const row = rows.get(id);
      if (row) row.messageId = messageId;
    },
    findLatestForSession: async (sessionId: string) => {
      polls += 1;
      const row = [...rows.values()].find((r) => r.sessionId === sessionId) ?? null;
      if (row && opts.answerAfterPolls !== undefined && polls >= opts.answerAfterPolls) {
        row.status = 'answered';
        row.answer = 'Push both';
        row.answeredAt = new Date();
      }
      return row;
    },
  } as never as import('../db/telegramAnswersRepository.js').TelegramAnswersRepository;

  const post = async (token: string, chatId: string, text: string) => {
    posted.push({ token, chatId, text });
    return 42;
  };

  const sleep = async (ms: number) => {
    slept.push(ms);
  };

  return { repo, post, sleep, posted, slept, pollCount: () => polls };
}

describe('askTelegram', () => {
  it('posts the question and returns the reply once answered', async () => {
    const { repo, post, sleep, posted } = harness({ answerAfterPolls: 2 });
    const result = await askTelegram('sess-1', 'Push both?', { env: envWith(), repo, post, sleep });

    expect(result).toEqual({ answered: true, answer: 'Push both' });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toContain('Push both?');
  });

  it('times out rather than blocking forever', async () => {
    const { repo, post, sleep } = harness();
    const result = await askTelegram('sess-1', 'Push both?', {
      env: envWith(),
      repo,
      post,
      sleep,
      timeoutMs: 1,
    });

    expect(result).toEqual({ answered: false, reason: 'timed_out' });
  });

  it('throws if Telegram credentials are not configured', async () => {
    const { repo, post, sleep } = harness();
    await expect(
      askTelegram('sess-1', 'Push both?', {
        env: envWith({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' }),
        repo,
        post,
        sleep,
      }),
    ).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it('only resolves once the row it created (not a stale one) is answered', async () => {
    const { repo, post, sleep, pollCount } = harness({ answerAfterPolls: 3 });
    const result = await askTelegram('sess-1', 'Q?', { env: envWith(), repo, post, sleep });
    expect(result).toEqual({ answered: true, answer: 'Push both' });
    expect(pollCount()).toBeGreaterThanOrEqual(3);
  });
});
