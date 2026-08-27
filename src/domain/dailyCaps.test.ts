import { describe, expect, it } from 'vitest';
import {
  canSendAnyDm,
  canSendReminderPing,
  DEFAULT_MAX_DMS_PER_DAY,
  DEFAULT_MAX_PINGS_PER_REMINDER,
} from './dailyCaps.js';

describe('canSendReminderPing', () => {
  it('allows when under the default cap', () => {
    expect(canSendReminderPing(2)).toBe(true);
  });

  it('blocks at the default cap', () => {
    expect(canSendReminderPing(DEFAULT_MAX_PINGS_PER_REMINDER)).toBe(false);
  });

  it('respects a custom override', () => {
    expect(canSendReminderPing(5, 10)).toBe(true);
  });
});

describe('canSendAnyDm', () => {
  it('allows when under the default cap', () => {
    expect(canSendAnyDm(9)).toBe(true);
  });

  it('blocks at the default cap', () => {
    expect(canSendAnyDm(DEFAULT_MAX_DMS_PER_DAY)).toBe(false);
  });

  it('respects a custom override', () => {
    expect(canSendAnyDm(15, 20)).toBe(true);
  });
});
