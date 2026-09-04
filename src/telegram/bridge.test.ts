import { describe, expect, it } from 'vitest';
import { startTelegramBridge } from './bridge.js';

type Post = { chatId: string; text: string; replyToMessageId?: number };

function harness(
  opts: {
    answer?: string | null;
    updateBatches?: unknown[][];
    postThrows?: boolean;
    failOnCall?: number;
  } = {},
) {
  const posts: Post[] = [];
  const logs: string[] = [];
  const recorded: Array<{ messageId: number; answer: string }> = [];
  const slept: number[] = [];
  const batches = opts.updateBatches ?? [[]];
  let call = 0;

  const repo = {
    recordAnswer: async (messageId: number, answer: string) => {
      recorded.push({ messageId, answer });
      if (opts.answer === null) return null;
      return { sessionId: 'sess-1', answer: opts.answer ?? answer };
    },
  } as never;

  const run = startTelegramBridge('bot-token', repo, {
    fetchUpdates: async () => {
      const thisCall = call;
      call += 1;
      if (opts.failOnCall !== undefined && thisCall === opts.failOnCall) {
        throw new Error('connect timeout');
      }
      return (batches[thisCall] ?? []) as never;
    },
    postMessage: async (_token, chatId, text, options) => {
      if (opts.postThrows) throw new Error('telegram down');
      posts.push({ chatId, text, replyToMessageId: options?.replyToMessageId });
      return 999;
    },
    log: (m) => logs.push(m),
    sleep: async (ms) => {
      slept.push(ms);
    },
    shouldStop: () => call >= batches.length,
  });

  return { run, posts, logs, recorded, slept };
}

const update = (over: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: {
    message_id: 42,
    chat: { id: 555 },
    text: '1',
    reply_to_message: { message_id: 111 },
    ...over,
  },
});

describe('startTelegramBridge', () => {
  it('records a reply-to reply and acks it back to the same chat', async () => {
    const { run, posts, recorded } = harness({ updateBatches: [[update()]] });
    await run;

    expect(recorded).toEqual([{ messageId: 111, answer: '1' }]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ chatId: '555', replyToMessageId: 42 });
    expect(posts[0]?.text).toContain('recorded');
  });

  it('ignores messages that are not replies', async () => {
    const { run, recorded } = harness({
      updateBatches: [[update({ reply_to_message: undefined })]],
    });
    await run;
    expect(recorded).toEqual([]);
  });

  it('does not ack a reply that matched no pending question', async () => {
    const { run, posts } = harness({ answer: null, updateBatches: [[update()]] });
    await run;
    expect(posts).toEqual([]);
  });

  it('still records the answer when the ack cannot be posted', async () => {
    const { run, recorded, logs } = harness({ postThrows: true, updateBatches: [[update()]] });
    await run;
    expect(recorded).toHaveLength(1);
    expect(logs.some((l) => l.includes('ack failed'))).toBe(true);
  });

  it('retries after a transient fetchUpdates failure instead of crashing', async () => {
    const { run, recorded, logs, slept } = harness({
      failOnCall: 0,
      updateBatches: [[], [update()]],
    });
    await run;

    expect(logs.some((l) => l.includes('getUpdates failed, retrying'))).toBe(true);
    expect(slept).toEqual([5000]);
    expect(recorded).toEqual([{ messageId: 111, answer: '1' }]);
  });

  it('advances the offset across multiple batches without reprocessing', async () => {
    const { run, recorded } = harness({
      updateBatches: [
        [update({ update_id: 1, message_id: 42 })],
        [update({ update_id: 2, message_id: 43, reply_to_message: { message_id: 222 } })],
      ],
    });
    await run;
    expect(recorded).toEqual([
      { messageId: 111, answer: '1' },
      { messageId: 222, answer: '1' },
    ]);
  });
});
