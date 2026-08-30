import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { mentionConfigFromEnv, mentionPrefix, shouldMention } from './mention.js';

const DB = 'postgres://u:p@localhost:5432/db';
const config = (over: Partial<ReturnType<typeof mentionConfigFromEnv>> = {}) => ({
  userId: 'U123',
  enabled: true,
  scope: 'questions' as const,
  ...over,
});

describe('mentionConfigFromEnv', () => {
  it('defaults to enabled, questions-only once an id is set', () => {
    const env = loadEnv({ DATABASE_URL: DB, SLACK_MENTION_USER_ID: 'U123' });
    expect(mentionConfigFromEnv(env)).toEqual({
      userId: 'U123',
      enabled: true,
      scope: 'questions',
    });
  });

  it('honours an explicit disable without discarding the id', () => {
    const env = loadEnv({
      DATABASE_URL: DB,
      SLACK_MENTION_USER_ID: 'U123',
      SLACK_MENTION_ENABLED: 'false',
    });
    const cfg = mentionConfigFromEnv(env);
    expect(cfg.enabled).toBe(false);
    expect(cfg.userId).toBe('U123');
  });

  it('reads the scope override', () => {
    const env = loadEnv({
      DATABASE_URL: DB,
      SLACK_MENTION_USER_ID: 'U123',
      SLACK_MENTION_SCOPE: 'all',
    });
    expect(mentionConfigFromEnv(env).scope).toBe('all');
  });

  it.each(['0', 'false', 'no', 'off', 'FALSE', ' Off '])('treats %s as disabled', (raw) => {
    const env = loadEnv({ DATABASE_URL: DB, SLACK_MENTION_ENABLED: raw });
    expect(env.slackMentionEnabled).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'on', 'TRUE'])('treats %s as enabled', (raw) => {
    const env = loadEnv({ DATABASE_URL: DB, SLACK_MENTION_ENABLED: raw });
    expect(env.slackMentionEnabled).toBe(true);
  });

  it('rejects an ambiguous toggle rather than guessing', () => {
    expect(() => loadEnv({ DATABASE_URL: DB, SLACK_MENTION_ENABLED: 'maybe' })).toThrowError(
      /true\/false/,
    );
  });

  it('rejects an unknown scope', () => {
    expect(() => loadEnv({ DATABASE_URL: DB, SLACK_MENTION_SCOPE: 'sometimes' })).toThrowError();
  });
});

describe('shouldMention', () => {
  it('tags questions but not notices by default', () => {
    expect(shouldMention(config(), 'question')).toBe(true);
    expect(shouldMention(config(), 'notice')).toBe(false);
  });

  it('tags both kinds when scope is all', () => {
    expect(shouldMention(config({ scope: 'all' }), 'question')).toBe(true);
    expect(shouldMention(config({ scope: 'all' }), 'notice')).toBe(true);
  });

  it('never tags when disabled, whatever the scope', () => {
    expect(shouldMention(config({ enabled: false }), 'question')).toBe(false);
    expect(shouldMention(config({ enabled: false, scope: 'all' }), 'notice')).toBe(false);
  });

  it('never tags without a member id, since @name does not notify', () => {
    expect(shouldMention(config({ userId: undefined }), 'question')).toBe(false);
    expect(shouldMention(config({ userId: undefined, scope: 'all' }), 'notice')).toBe(false);
  });
});

describe('mentionPrefix', () => {
  it('renders a real Slack mention with a trailing space', () => {
    expect(mentionPrefix(config(), 'question')).toBe('<@U123> ');
  });

  it('renders nothing when the post should not be tagged', () => {
    expect(mentionPrefix(config(), 'notice')).toBe('');
    expect(mentionPrefix(config({ enabled: false }), 'question')).toBe('');
  });
});
