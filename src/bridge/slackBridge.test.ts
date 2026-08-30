import { describe, expect, it, vi } from 'vitest';

/**
 * `startSlackBridge` opens a Socket Mode connection in its constructor, so the
 * client is stubbed and the registered `message` handler is invoked directly.
 */
const handlers: Record<string, (arg: unknown) => Promise<void>> = {};
vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: class {
    on(name: string, fn: (arg: unknown) => Promise<void>) {
      handlers[name] = fn;
    }
  },
}));

const { startSlackBridge } = await import('./slackBridge.js');

type Post = { channel: string; text: string; threadTs?: string };

function harness(opts: { answer?: string | null; botToken?: string; postThrows?: boolean } = {}) {
  const posts: Post[] = [];
  const logs: string[] = [];
  const recorded: Array<{ threadTs: string; answer: string }> = [];

  const repo = {
    recordAnswer: async (threadTs: string, answer: string) => {
      recorded.push({ threadTs, answer });
      return opts.answer === null
        ? null
        : { sessionId: 'sess-1', answer: opts.answer ?? answer };
    },
  } as never;

  startSlackBridge('xapp-test', repo, {
    botToken: opts.botToken,
    postMessage: async (_token, channel, text, options) => {
      if (opts.postThrows) throw new Error('slack down');
      posts.push({ channel, text, threadTs: options?.threadTs });
      return '999.000';
    },
    log: (m) => logs.push(m),
  });

  const send = (event: Record<string, unknown>) =>
    handlers.message?.({ event, ack: async () => {} });

  return { send, posts, logs, recorded };
}

const reply = (over: Record<string, unknown> = {}) => ({
  type: 'message',
  text: '1',
  thread_ts: '111.222',
  channel: 'C1',
  ...over,
});

describe('startSlackBridge', () => {
  it('records a threaded reply and acks it in the same thread', async () => {
    const { send, posts, recorded } = harness({ botToken: 'xoxb' });
    await send(reply());

    expect(recorded).toEqual([{ threadTs: '111.222', answer: '1' }]);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ channel: 'C1', threadTs: '111.222' });
    expect(posts[0]?.text).toContain('recorded');
    expect(posts[0]?.text).toContain('1');
  });

  it('ignores its own acknowledgement so it cannot loop', async () => {
    const { send, posts, recorded } = harness({ botToken: 'xoxb' });
    await send(reply({ bot_id: 'B123' }));
    expect(recorded).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('ignores top-level messages that are not thread replies', async () => {
    const { send, recorded } = harness({ botToken: 'xoxb' });
    await send(reply({ thread_ts: undefined }));
    expect(recorded).toEqual([]);
  });

  it('ignores edits and other subtypes', async () => {
    const { send, recorded } = harness({ botToken: 'xoxb' });
    await send(reply({ subtype: 'message_changed' }));
    expect(recorded).toEqual([]);
  });

  it('does not ack a reply that matched no pending question', async () => {
    const { send, posts } = harness({ botToken: 'xoxb', answer: null });
    await send(reply());
    expect(posts).toEqual([]);
  });

  it('still records the answer when the ack cannot be posted', async () => {
    const { send, recorded, logs } = harness({ botToken: 'xoxb', postThrows: true });
    await send(reply());

    expect(recorded).toHaveLength(1); // the answer survived
    expect(logs.some((l) => l.includes('ack failed'))).toBe(true);
  });

  it('records silently when no bot token is configured', async () => {
    const { send, posts, recorded } = harness({});
    await send(reply());
    expect(recorded).toHaveLength(1);
    expect(posts).toEqual([]);
  });

  it('truncates a long answer in the ack', async () => {
    const { send, posts } = harness({ botToken: 'xoxb' });
    await send(reply({ text: 'x'.repeat(200) }));
    expect(posts[0]?.text.length).toBeLessThan(140);
    expect(posts[0]?.text).toContain('…');
  });
});
