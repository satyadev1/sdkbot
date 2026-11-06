import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { notifySlack } from './notifySlack.js';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', SLACK_BOT_TOKEN: 'xoxb-test' };

describe('notifySlack', () => {
  it('posts to the notice channel, not the main channel', async () => {
    const env = loadEnv({ ...base, SLACK_CHANNEL_ID: 'CMAIN', SLACK_NOTICE_CHANNEL_ID: 'CNOTICE' });
    const posted: Array<{ channel: string; text: string }> = [];
    await notifySlack('deployed', {
      env,
      post: async (_t, channel, text) => (posted.push({ channel, text }), 'ts'),
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]?.channel).toBe('CNOTICE');
    expect(posted[0]?.text).toContain('deployed');
  });

  it('throws when the notice channel is unset', async () => {
    const env = loadEnv({ ...base, SLACK_CHANNEL_ID: 'CMAIN' });
    await expect(notifySlack('x', { env, post: async () => 'ts' })).rejects.toThrow(
      /SLACK_NOTICE_CHANNEL_ID/,
    );
  });
});
