import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      NODE_ENV: 'test',
    });
    expect(env).toEqual({
      databaseUrl: 'postgres://u:p@localhost:5432/db',
      nodeEnv: 'test',
    });
  });

  it('defaults NODE_ENV to development when unset', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env.nodeEnv).toBe('development');
  });

  it('parses SLACK_WEBHOOK_URL when present', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/XXXX',
    });
    expect(env.slackWebhookUrl).toBe('https://hooks.slack.com/services/T000/B000/XXXX');
  });

  it('leaves slackWebhookUrl undefined when unset', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' });
    expect(env.slackWebhookUrl).toBeUndefined();
  });

  it('treats an empty SLACK_WEBHOOK_URL as unset rather than throwing', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/db', SLACK_WEBHOOK_URL: '' });
    expect(env.slackWebhookUrl).toBeUndefined();
  });

  it('parses SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_CHANNEL_ID when present', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      SLACK_BOT_TOKEN: 'xoxb-test',
      SLACK_APP_TOKEN: 'xapp-test',
      SLACK_CHANNEL_ID: 'C12345',
    });
    expect(env.slackBotToken).toBe('xoxb-test');
    expect(env.slackAppToken).toBe('xapp-test');
    expect(env.slackChannelId).toBe('C12345');
  });

  it('throws with a clear message when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrowError(/DATABASE_URL/);
  });

  it('never includes raw env values in thrown error stack beyond the field name', () => {
    try {
      loadEnv({ DATABASE_URL: '' });
    } catch (err) {
      expect(String(err)).not.toContain('secret');
    }
  });
});
