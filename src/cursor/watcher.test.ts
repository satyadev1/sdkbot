import { describe, expect, it, vi } from 'vitest';
import type { MentionConfig } from '../slack/mention.js';
import type { PendingQuestion } from './chatStore.js';
import { startCursorWatcher } from './watcher.js';

const question = (overrides: Partial<PendingQuestion> = {}): PendingQuestion => ({
  sessionId: 'f3f6fa85-92a0-44e7-834f-da0f69da50a4',
  bubbleId: '17b4e593-854e-425e-9dc5-14d44f7bac8b',
  text: 'Q: Ship it? (options: Yes, No)',
  workspaceId: 'ws1',
  key: 'bubbleId:f3f6fa85-92a0-44e7-834f-da0f69da50a4:17b4e593-854e-425e-9dc5-14d44f7bac8b',
  ...overrides,
});

/** Harness with a controllable pending-question feed and a fake repo. */
function harness(feeds: PendingQuestion[][], mention?: MentionConfig) {
  const posts: string[] = [];
  const created: string[] = [];
  let call = 0;

  const repo = {
    createIfNew: async (input: { dedupeKey: string }) => {
      created.push(input.dedupeKey);
      return { id: `row-${created.length}` };
    },
    setThreadTs: async () => {},
  } as never;

  const watcher = startCursorWatcher({
    repo,
    botToken: 'token',
    channelId: 'C1',
    intervalMs: 5,
    mention,
    resolveWorkspaceName: async () => 'my-project',
    postMessage: async (_t, _c, text) => {
      posts.push(text);
      return '123.456';
    },
    findPending: async () => {
      const feed = feeds[Math.min(call, feeds.length - 1)] ?? [];
      call += 1;
      return feed;
    },
    log: () => {},
  });

  return { watcher, posts, created };
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe('startCursorWatcher', () => {
  it('does not post questions that were already pending at startup', async () => {
    const { watcher, posts } = harness([[question()], [question()]]);
    await settle();
    watcher.stop();
    expect(posts).toEqual([]);
  });

  it('posts a question that appears after startup', async () => {
    const { watcher, posts } = harness([[], [question()]]);
    await settle();
    watcher.stop();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('{CURSOR} `my-project` is waiting for your answer');
    expect(posts[0]).toContain('Q: Ship it? (options: Yes, No)');
    expect(posts[0]).toContain('Reply in this thread to answer.');
  });

  it('leads the post with a mention so Slack notifies in the preview', async () => {
    const { watcher, posts } = harness([[], [question()]], {
      userId: 'U9',
      enabled: true,
      scope: 'questions',
    });
    await settle();
    watcher.stop();
    expect(posts[0]?.startsWith('<@U9> :question:')).toBe(true);
  });

  it('omits the mention when tagging is disabled', async () => {
    const { watcher, posts } = harness([[], [question()]], {
      userId: 'U9',
      enabled: false,
      scope: 'questions',
    });
    await settle();
    watcher.stop();
    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toContain('<@U9>');
    expect(posts[0]?.startsWith(':question:')).toBe(true);
  });

  it('posts untagged when no mention is configured at all', async () => {
    const { watcher, posts } = harness([[], [question()]]);
    await settle();
    watcher.stop();
    expect(posts[0]).not.toContain('<@');
  });

  it('posts each question bubble only once while it stays pending', async () => {
    // A pending question keeps being returned every poll until answered.
    const { watcher, posts, created } = harness([[], [question()], [question()], [question()]]);
    await settle();
    watcher.stop();

    expect(posts).toHaveLength(1);
    expect(created).toEqual([question().key]);
  });

  it('posts distinct bubbles separately', async () => {
    const second = question({ bubbleId: 'bbb', key: 'bubbleId:sess:bbb' });
    const { watcher, posts } = harness([[], [question()], [question(), second]]);
    await settle();
    watcher.stop();
    expect(posts).toHaveLength(2);
  });

  it('skips posting when the row was already recorded by a previous run', async () => {
    const posts: string[] = [];
    const repo = {
      createIfNew: async () => null, // dedupe_key collision
      setThreadTs: async () => {},
    } as never;

    const watcher = startCursorWatcher({
      repo,
      botToken: 'token',
      channelId: 'C1',
      intervalMs: 5,
      resolveWorkspaceName: async () => 'my-project',
      postMessage: async (_t, _c, text) => {
        posts.push(text);
        return '1';
      },
      findPending: async () => [question()],
      log: () => {},
    });

    await settle();
    watcher.stop();
    expect(posts).toEqual([]);
  });

  it('keeps polling after an error on one question', async () => {
    const logs: string[] = [];
    let calls = 0;
    const repo = {
      createIfNew: async () => {
        calls += 1;
        if (calls === 1) throw new Error('db down');
        return { id: 'row-1' };
      },
      setThreadTs: async () => {},
    } as never;

    const posts: string[] = [];
    const feeds = [[], [question()], [question({ bubbleId: 'b2', key: 'k2' })]];
    let i = 0;
    const watcher = startCursorWatcher({
      repo,
      botToken: 't',
      channelId: 'C1',
      intervalMs: 5,
      resolveWorkspaceName: async () => 'p',
      postMessage: async (_t, _c, text) => {
        posts.push(text);
        return '1';
      },
      findPending: async () => feeds[Math.min(i++, feeds.length - 1)] ?? [],
      log: (m) => logs.push(m),
    });

    await settle();
    watcher.stop();

    expect(logs.some((l) => l.includes('db down'))).toBe(true);
    expect(posts).toHaveLength(1); // the second question still got through
  });

  it('stops polling once stopped', async () => {
    const findPending = vi.fn(async () => []);
    const watcher = startCursorWatcher({
      repo: { createIfNew: async () => null, setThreadTs: async () => {} } as never,
      botToken: 't',
      channelId: 'C1',
      intervalMs: 5,
      findPending,
      log: () => {},
    });
    await settle(40);
    watcher.stop();
    const afterStop = findPending.mock.calls.length;
    await settle(40);
    expect(findPending.mock.calls.length).toBe(afterStop);
  });
});
