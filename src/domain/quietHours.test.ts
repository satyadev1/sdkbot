import { describe, expect, it } from 'vitest';
import { isWithinQuietHours, nextAllowedTime, type QuietHours } from './quietHours.js';

const DEFAULT: QuietHours = { startHour: 22, endHour: 8 };

describe('isWithinQuietHours', () => {
  it('is true at 23:00 local time', () => {
    // 2026-01-15T23:00:00 in America/New_York = 2026-01-16T04:00:00Z
    const at = new Date('2026-01-16T04:00:00.000Z');
    expect(isWithinQuietHours(at, 'America/New_York', DEFAULT)).toBe(true);
  });

  it('is true at 06:00 local time (overnight wrap)', () => {
    // 2026-01-16T06:00:00 America/New_York = 2026-01-16T11:00:00Z
    const at = new Date('2026-01-16T11:00:00.000Z');
    expect(isWithinQuietHours(at, 'America/New_York', DEFAULT)).toBe(true);
  });

  it('is false at 14:00 local time', () => {
    // 2026-01-16T14:00:00 America/New_York = 2026-01-16T19:00:00Z
    const at = new Date('2026-01-16T19:00:00.000Z');
    expect(isWithinQuietHours(at, 'America/New_York', DEFAULT)).toBe(false);
  });

  it('is false exactly at end hour boundary (08:00)', () => {
    const at = new Date('2026-01-16T13:00:00.000Z'); // 08:00 America/New_York
    expect(isWithinQuietHours(at, 'America/New_York', DEFAULT)).toBe(false);
  });
});

describe('nextAllowedTime', () => {
  it('returns end-of-quiet-hours same day when currently before it', () => {
    // 2026-01-16T02:00:00 America/New_York = 2026-01-16T07:00:00Z
    const at = new Date('2026-01-16T07:00:00.000Z');
    const next = nextAllowedTime(at, 'America/New_York', DEFAULT);
    // expect 08:00 America/New_York same day = 13:00Z
    expect(next.toISOString()).toBe('2026-01-16T13:00:00.000Z');
  });

  it('returns end-of-quiet-hours next day when currently after start hour', () => {
    // 2026-01-16T23:00:00 America/New_York = 2026-01-17T04:00:00Z
    const at = new Date('2026-01-17T04:00:00.000Z');
    const next = nextAllowedTime(at, 'America/New_York', DEFAULT);
    // expect 08:00 America/New_York on 2026-01-17 = 13:00Z
    expect(next.toISOString()).toBe('2026-01-17T13:00:00.000Z');
  });

  it('returns the same instant when not in quiet hours', () => {
    const at = new Date('2026-01-16T19:00:00.000Z'); // 14:00 America/New_York
    const next = nextAllowedTime(at, 'America/New_York', DEFAULT);
    expect(next.toISOString()).toBe(at.toISOString());
  });
});
