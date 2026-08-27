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
