import { describe, expect, it } from 'vitest';
import {
  applyAction,
  decideNextNotification,
  type ReminderSnapshot,
  type SchedulingContext,
} from './reminderStateMachine.js';

const openInitial: ReminderSnapshot = {
  state: 'open',
  escalationStage: 'initial',
  pingsSentForReminder: 0,
};

const baseContext: SchedulingContext = {
  timezone: 'America/New_York',
  quietHours: { startHour: 22, endHour: 8 },
  dmsAlreadySentToday: 0,
};

describe('decideNextNotification', () => {
  it('sends immediately when not in quiet hours and under caps', () => {
    const at = new Date('2026-01-16T19:00:00.000Z'); // 14:00 America/New_York
    const decision = decideNextNotification(openInitial, at, baseContext);
    expect(decision).toEqual({ kind: 'send', at });
  });

  it('queues until quiet hours end when proposed time falls in quiet hours', () => {
    const at = new Date('2026-01-16T04:00:00.000Z'); // 23:00 America/New_York
    const decision = decideNextNotification(openInitial, at, baseContext);
    expect(decision.kind).toBe('queue');
    if (decision.kind === 'queue') {
      expect(decision.reason).toBe('quiet_hours');
      expect(decision.at.toISOString()).toBe('2026-01-16T13:00:00.000Z'); // 08:00 next boundary
    }
  });

  it('stops when the per-reminder ping cap is already reached', () => {
    const snapshot: ReminderSnapshot = { ...openInitial, pingsSentForReminder: 3 };
    const at = new Date('2026-01-16T19:00:00.000Z');
    const decision = decideNextNotification(snapshot, at, baseContext);
    expect(decision).toEqual({ kind: 'stop' });
  });

  it('queues (does not stop) when the daily DM cap is reached, since it is workspace-wide not per-item', () => {
    const at = new Date('2026-01-16T19:00:00.000Z');
    const decision = decideNextNotification(openInitial, at, { ...baseContext, dmsAlreadySentToday: 10 });
    expect(decision.kind).toBe('queue');
    if (decision.kind === 'queue') {
      expect(decision.reason).toBe('daily_cap_reached');
    }
  });

  it('stops when the reminder is already done', () => {
    const snapshot: ReminderSnapshot = { ...openInitial, state: 'done' };
    const at = new Date('2026-01-16T19:00:00.000Z');
    expect(decideNextNotification(snapshot, at, baseContext)).toEqual({ kind: 'stop' });
  });
});

describe('applyAction', () => {
  it('done sets state to done with no next due time', () => {
    const now = new Date('2026-01-16T19:00:00.000Z');
    const result = applyAction(openInitial, 'done', now);
    expect(result.snapshot.state).toBe('done');
    expect(result.nextDueAt).toBeNull();
  });

  it('dismiss sets state to dismissed with no next due time', () => {
    const now = new Date('2026-01-16T19:00:00.000Z');
    const result = applyAction(openInitial, 'dismiss', now);
    expect(result.snapshot.state).toBe('dismissed');
    expect(result.nextDueAt).toBeNull();
  });

  it('snooze_15 stays open and sets next due time 15 minutes out', () => {
    const now = new Date('2026-01-16T19:00:00.000Z');
    const result = applyAction(openInitial, 'snooze_15', now);
    expect(result.snapshot.state).toBe('open');
    expect(result.nextDueAt?.toISOString()).toBe('2026-01-16T19:15:00.000Z');
  });

  it('snooze_1h stays open and sets next due time 1 hour out', () => {
    const now = new Date('2026-01-16T19:00:00.000Z');
    const result = applyAction(openInitial, 'snooze_1h', now);
    expect(result.snapshot.state).toBe('open');
    expect(result.nextDueAt?.toISOString()).toBe('2026-01-16T20:00:00.000Z');
  });

  it('reschedule resets escalation stage to initial and pings to 0', () => {
    const snapshot: ReminderSnapshot = {
      state: 'open',
      escalationStage: 'followup_2h',
      pingsSentForReminder: 2,
    };
    const now = new Date('2026-01-16T19:00:00.000Z');
    const result = applyAction(snapshot, 'reschedule', now);
    expect(result.snapshot.escalationStage).toBe('initial');
    expect(result.snapshot.pingsSentForReminder).toBe(0);
    expect(result.nextDueAt?.toISOString()).toBe('2026-01-16T19:00:00.000Z');
  });
});
