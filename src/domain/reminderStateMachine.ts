import {
  canSendAnyDm,
  canSendReminderPing,
  DEFAULT_MAX_DMS_PER_DAY,
  DEFAULT_MAX_PINGS_PER_REMINDER,
} from './dailyCaps.js';
import type { EscalationStage } from './escalationPolicy.js';
import { isWithinQuietHours, nextAllowedTime, type QuietHours } from './quietHours.js';

export type ReminderState = 'open' | 'done' | 'dismissed';
export type ReminderAction = 'done' | 'snooze_15' | 'snooze_1h' | 'reschedule' | 'dismiss';

export type ReminderSnapshot = {
  state: ReminderState;
  escalationStage: EscalationStage;
  pingsSentForReminder: number;
};

export type SchedulingContext = {
  timezone: string;
  quietHours: QuietHours;
  dmsAlreadySentToday: number;
  maxPingsPerReminder?: number;
  maxDmsPerDay?: number;
};

export type SendDecision =
  | { kind: 'send'; at: Date }
  | { kind: 'queue'; at: Date; reason: 'quiet_hours' | 'daily_cap_reached' }
  | { kind: 'stop' };

export function decideNextNotification(
  snapshot: ReminderSnapshot,
  proposedAt: Date,
  context: SchedulingContext,
): SendDecision {
  // If reminder is not open, stop
  if (snapshot.state !== 'open') {
    return { kind: 'stop' };
  }

  // Check per-reminder ping cap first
  if (
    !canSendReminderPing(
      snapshot.pingsSentForReminder,
      context.maxPingsPerReminder ?? DEFAULT_MAX_PINGS_PER_REMINDER,
    )
  ) {
    return { kind: 'stop' };
  }

  // Check quiet hours
  if (isWithinQuietHours(proposedAt, context.timezone, context.quietHours)) {
    return {
      kind: 'queue',
      reason: 'quiet_hours',
      at: nextAllowedTime(proposedAt, context.timezone, context.quietHours),
    };
  }

  // Check daily DM cap (workspace-wide, so queue not stop)
  if (!canSendAnyDm(context.dmsAlreadySentToday, context.maxDmsPerDay ?? DEFAULT_MAX_DMS_PER_DAY)) {
    return { kind: 'queue', reason: 'daily_cap_reached', at: proposedAt };
  }

  // All checks pass, send now
  return { kind: 'send', at: proposedAt };
}

export function applyAction(
  snapshot: ReminderSnapshot,
  action: ReminderAction,
  now: Date,
): { snapshot: ReminderSnapshot; nextDueAt: Date | null } {
  switch (action) {
    case 'done':
      return { snapshot: { ...snapshot, state: 'done' }, nextDueAt: null };
    case 'dismiss':
      return { snapshot: { ...snapshot, state: 'dismissed' }, nextDueAt: null };
    case 'snooze_15':
      return { snapshot: { ...snapshot, state: 'open' }, nextDueAt: new Date(now.getTime() + 15 * 60_000) };
    case 'snooze_1h':
      return { snapshot: { ...snapshot, state: 'open' }, nextDueAt: new Date(now.getTime() + 60 * 60_000) };
    case 'reschedule':
      return {
        snapshot: { state: 'open', escalationStage: 'initial', pingsSentForReminder: 0 },
        nextDueAt: now,
      };
  }
}
