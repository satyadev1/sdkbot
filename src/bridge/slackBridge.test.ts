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

function harness(
  opts: {
    answer?: string | null;
    botToken?: string;
    postThrows?: boolean;
    question?: string;
    /** Enables the inbound-command path. */
    command?: boolean;
    commandResult?: { ok: true; result: string } | { ok: false; error: string };
  } = {},
) {
  const posts: Post[] = [];
  const logs: string[] = [];
  const recorded: Array<{ threadTs: string; answer: string }> = [];
  const prompts: string[] = [];

  const repo = {
    // Mirrors the real signature: the bridge passes a resolver, which the
    // repository applies against the stored question text.
    recordAnswer: async (
      threadTs: string,
      answer: string,
      resolve?: (question: string | null, reply: string) => string,
    ) => {
      recorded.push({ threadTs, answer });
      if (opts.answer === null) return null;
      const stored = opts.answer ?? (resolve ? resolve(opts.question ?? null, answer) : answer);
      return { sessionId: 'sess-1', answer: stored };
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
    command: opts.command
      ? {
          botUserId: 'UBOT',
          allowedUserId: 'UOWNER',
          run: async (prompt) => {
            prompts.push(prompt);
            return opts.commandResult ?? { ok: true, result: '4' };
          },
        }
      : undefined,
  });

  const send = (event: Record<string, unknown>) =>
    handlers.message?.({ event, ack: async () => {} });

  return { send, posts, logs, recorded, prompts };
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

  it('shows both the reply and the option it resolved to', async () => {
    const { send, posts } = harness({
      botToken: 'xoxb',
      question: 'Q: Push? (options: Push both, Hold)',
    });
    await send(reply({ text: '1' }));

    // Both halves matter: the digit you sent, and what it was taken to mean.
    expect(posts[0]?.text).toContain('`1`');
    expect(posts[0]?.text).toContain('Push both');
  });

  it('does not add an arrow when the reply needed no resolving', async () => {
    const { send, posts } = harness({
      botToken: 'xoxb',
      question: 'Q: Push? (options: Push both, Hold)',
    });
    await send(reply({ text: 'something else entirely' }));
    expect(posts[0]?.text).not.toContain('→');
  });

  it('ignores its own acknowledgement so it cannot loop', async () => {
    const { send, posts, recorded } = harness({ botToken: 'xoxb' });
    await send(reply({ bot_id: 'B123' }));
    expect(recorded).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('never treats a top-level message as an answer', async () => {
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

/** A top-level channel message, i.e. a candidate command rather than an answer. */
const command = (over: Record<string, unknown> = {}) => ({
  type: 'message',
  text: '<@UBOT> what is 2+2',
  channel: 'C1',
  ts: '333.444',
  user: 'UOWNER',
  ...over,
});

describe('startSlackBridge inbound commands', () => {
  it('runs a mentioned command and answers under it', async () => {
    const { send, posts, prompts } = harness({ botToken: 'xoxb', command: true });
    await send(command());

    expect(prompts).toEqual(['what is 2+2']); // mention stripped
    // Threaded under the command's own ts, so it cannot be mistaken for an
    // answer to an ask_slack question.
    expect(posts.every((p) => p.threadTs === '333.444')).toBe(true);
    expect(posts[0]?.text).toContain('working');
    expect(posts.at(-1)?.text).toBe('4');
  });

  it('refuses a command from anyone but the allowed user', async () => {
    const { send, posts, prompts, logs } = harness({ botToken: 'xoxb', command: true });
    await send(command({ user: 'UINTRUDER' }));

    expect(prompts).toEqual([]); // nothing executed
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toContain('Not authorised');
    expect(logs.some((l) => l.includes('refused command from UINTRUDER'))).toBe(true);
  });

  it('ignores a top-level message that does not mention the bot', async () => {
    const { send, posts, prompts, logs } = harness({ botToken: 'xoxb', command: true });
    await send(command({ text: 'just chatting with a colleague' }));

    expect(prompts).toEqual([]);
    expect(posts).toEqual([]); // stays quiet in a shared channel
    expect(logs.some((l) => l.includes('no mention'))).toBe(true);
  });

  it('does not mistake a mention of someone else for a command', async () => {
    const { send, prompts, posts } = harness({ botToken: 'xoxb', command: true });
    await send(command({ text: '<@USOMEONE> can you look at this' }));
    expect(prompts).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('asks for an instruction when mentioned with nothing else', async () => {
    const { send, posts, prompts } = harness({ botToken: 'xoxb', command: true });
    await send(command({ text: '<@UBOT>' }));

    expect(prompts).toEqual([]);
    expect(posts[0]?.text).toContain('Mention me with an instruction');
  });

  it('reports a failed run instead of going silent', async () => {
    const { send, posts } = harness({
      botToken: 'xoxb',
      command: true,
      commandResult: { ok: false, error: 'claude timed out' },
    });
    await send(command());
    expect(posts.at(-1)?.text).toContain('claude timed out');
  });

  it('logs top-level messages instead of dropping them when commands are off', async () => {
    const { send, posts, logs } = harness({ botToken: 'xoxb' });
    await send(command());

    expect(posts).toEqual([]);
    // The old behaviour left no trace at all, which is what made this
    // impossible to diagnose.
    expect(logs.some((l) => l.includes('not configured'))).toBe(true);
  });

  it('still ignores bot posts on the command path, so it cannot answer itself', async () => {
    const { send, prompts, posts } = harness({ botToken: 'xoxb', command: true });
    await send(command({ bot_id: 'B123', user: undefined }));
    expect(prompts).toEqual([]);
    expect(posts).toEqual([]);
  });
});
