import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import type { SlackAnswer } from '../db/slackAnswersRepository.js';
import { askSlack } from './askSlack.js';

const DB = 'postgres://u:p@localhost:5432/db';

function envWith(over: Record<string, string> = {}) {
  return loadEnv({
    DATABASE_URL: DB,
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C123',
    ...over,
  });
}

function harness(opts: { answerAfterPolls?: number } = {}) {
  const rows = new Map<string, SlackAnswer>();
  let polls = 0;
  const posted: Array<{ token: string; channel: string; text: string }> = [];
  const slept: number[] = [];

  const repo = {
    create: async (input: { sessionId: string; question?: string | null }) => {
      const row: SlackAnswer = {
        id: 'row-1',
        sessionId: input.sessionId,
        threadTs: null,
        question: input.question ?? null,
        answer: null,
        status: 'pending',
        createdAt: new Date(),
        answeredAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    setThreadTs: async (id: string, threadTs: string) => {
      const row = rows.get(id);
      if (row) row.threadTs = threadTs;
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
  } as never as import('../db/slackAnswersRepository.js').SlackAnswersRepository;

  const post = async (token: string, channel: string, text: string) => {
    posted.push({ token, channel, text });
    return 'ts-123';
  };

  const sleep = async (ms: number) => {
    slept.push(ms);
  };

  return { repo, post, sleep, posted, slept, pollCount: () => polls };
}

describe('askSlack', () => {
  it('posts the question, threads it, and returns the reply once answered', async () => {
    const { repo, post, sleep, posted } = harness({ answerAfterPolls: 2 });
    const result = await askSlack('sess-1', 'Push both?', { env: envWith(), repo, post, sleep });

    expect(result).toEqual({ answered: true, answer: 'Push both' });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.text).toContain('Push both?');
  });

  it('times out rather than blocking forever', async () => {
    const { repo, post, sleep } = harness();
    const result = await askSlack('sess-1', 'Push both?', {
      env: envWith(),
      repo,
      post,
      sleep,
      timeoutMs: 1,
    });

    expect(result).toEqual({ answered: false, reason: 'timed_out' });
  });

  it('throws if Slack bot credentials are not configured', async () => {
    const { repo, post, sleep } = harness();
    await expect(
      askSlack('sess-1', 'Push both?', {
        env: envWith({ SLACK_BOT_TOKEN: '', SLACK_CHANNEL_ID: '' }),
        repo,
        post,
        sleep,
      }),
    ).rejects.toThrow(/SLACK_BOT_TOKEN/);
  });

  it('only resolves once the row it created (not a stale one) is answered', async () => {
    const { repo, post, sleep, pollCount } = harness({ answerAfterPolls: 3 });
    const result = await askSlack('sess-1', 'Q?', { env: envWith(), repo, post, sleep });
    expect(result).toEqual({ answered: true, answer: 'Push both' });
    expect(pollCount()).toBeGreaterThanOrEqual(3);
  });
});
