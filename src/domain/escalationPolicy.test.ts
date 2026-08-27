import { describe, expect, it } from 'vitest';
import { nextEscalationTime } from './escalationPolicy.js';

describe('nextEscalationTime', () => {
  it('schedules a 30 minute followup after the initial send', () => {
    const from = new Date('2026-01-16T15:00:00.000Z');
    const result = nextEscalationTime('initial', from);
    expect(result.stage).toBe('followup_30m');
    expect(result.at.toISOString()).toBe('2026-01-16T15:30:00.000Z');
  });

  it('schedules a 2 hour followup after the 30 minute followup', () => {
    const from = new Date('2026-01-16T15:30:00.000Z');
    const result = nextEscalationTime('followup_30m', from);
    expect(result.stage).toBe('followup_2h');
    expect(result.at.toISOString()).toBe('2026-01-16T17:30:00.000Z');
  });

  it('schedules a daily followup after the 2 hour followup', () => {
    const from = new Date('2026-01-16T17:30:00.000Z');
    const result = nextEscalationTime('followup_2h', from);
    expect(result.stage).toBe('daily');
    expect(result.at.toISOString()).toBe('2026-01-17T17:30:00.000Z');
  });

  it('keeps repeating daily once in the daily stage', () => {
    const from = new Date('2026-01-17T17:30:00.000Z');
    const result = nextEscalationTime('daily', from);
    expect(result.stage).toBe('daily');
    expect(result.at.toISOString()).toBe('2026-01-18T17:30:00.000Z');
  });
});
