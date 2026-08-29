import { describe, expect, it } from 'vitest';
import { pendingQuestionsForSession, recentSessions, renderParams } from './chatStore.js';

const COL = '\x1f';
const ROW = '\x1e';

const bubble = (opts: {
  name?: string;
  status?: string;
  params?: string;
}) =>
  JSON.stringify({
    toolFormerData: {
      name: opts.name ?? 'ask_question',
      status: opts.status ?? 'loading',
      ...(opts.params === undefined ? {} : { params: opts.params }),
    },
  });

const PARAMS = JSON.stringify({
  questions: [
    {
      id: 'vibe',
      prompt: "What's the vibe right now?",
      options: [{ id: 'code', label: 'Write code' }, { id: 'chat', label: 'Just chatting' }],
    },
  ],
});

const SESSION = { composerId: 'sess-1', workspaceId: 'ws-1', recency: 1 };

describe('renderParams', () => {
  it('renders prompt with option labels', () => {
    expect(renderParams(PARAMS)).toBe(
      "Q: What's the vibe right now? (options: Write code, Just chatting)",
    );
  });

  it('renders a prompt with no options', () => {
    expect(renderParams(JSON.stringify({ questions: [{ prompt: 'Ready?' }] }))).toBe('Q: Ready?');
  });

  it('returns empty for malformed or promptless params', () => {
    expect(renderParams('not json')).toBe('');
    expect(renderParams(JSON.stringify({ questions: [{ options: [] }] }))).toBe('');
    expect(renderParams(JSON.stringify({}))).toBe('');
  });
});

describe('recentSessions', () => {
  it('parses rows newest-first and skips unsafe ids', async () => {
    const run = async () =>
      [
        ['good-1', 'ws-a', '200'].join(COL),
        ["bad'; drop table", 'ws-b', '150'].join(COL),
        ['good-2', '', '100'].join(COL),
      ].join(ROW);

    const sessions = await recentSessions('/db', 10, run);
    expect(sessions.map((s) => s.composerId)).toEqual(['good-1', 'good-2']);
    expect(sessions[0]).toEqual({ composerId: 'good-1', workspaceId: 'ws-a', recency: 200 });
  });
});

describe('pendingQuestionsForSession', () => {
  const rowFor = (key: string, value: string) => [key, value].join(COL);

  it('returns a loading ask_question with its rendered text', async () => {
    const run = async () =>
      rowFor(`bubbleId:sess-1:bub-1`, bubble({ status: 'loading', params: PARAMS }));

    const found = await pendingQuestionsForSession('/db', SESSION, run);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      sessionId: 'sess-1',
      bubbleId: 'bub-1',
      workspaceId: 'ws-1',
      key: 'bubbleId:sess-1:bub-1',
    });
    expect(found[0]?.text).toContain("What's the vibe right now?");
  });

  it('ignores questions the user already resolved', async () => {
    for (const status of ['completed', 'cancelled', 'error']) {
      const run = async () => rowFor('bubbleId:sess-1:b', bubble({ status, params: PARAMS }));
      await expect(pendingQuestionsForSession('/db', SESSION, run)).resolves.toEqual([]);
    }
  });

  it('ignores other tools that are still loading', async () => {
    const run = async () =>
      rowFor('bubbleId:sess-1:b', bubble({ name: 'read_file_v2', status: 'loading', params: PARAMS }));
    await expect(pendingQuestionsForSession('/db', SESSION, run)).resolves.toEqual([]);
  });

  it('skips rows with missing params or unparsable JSON', async () => {
    const run = async () =>
      [
        rowFor('bubbleId:sess-1:b1', bubble({ status: 'loading' })),
        rowFor('bubbleId:sess-1:b2', '{broken'),
        rowFor('bubbleId:sess-1:b3', JSON.stringify({ nope: true })),
      ].join(ROW);
    await expect(pendingQuestionsForSession('/db', SESSION, run)).resolves.toEqual([]);
  });

  it('queries an indexed key range rather than scanning values', async () => {
    let sql = '';
    const run = async (_db: string, query: string) => {
      sql = query;
      return '';
    };
    await pendingQuestionsForSession('/db', SESSION, run);
    expect(sql).toContain("key >= 'bubbleId:sess-1:'");
    expect(sql).toContain("key < 'bubbleId:sess-1;'");
  });

  it('refuses ids that are not safe to interpolate', async () => {
    const run = async () => {
      throw new Error('should not run');
    };
    await expect(
      pendingQuestionsForSession('/db', { ...SESSION, composerId: "x'; drop--" }, run),
    ).resolves.toEqual([]);
  });
});
