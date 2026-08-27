import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { UsersRepository } from './usersRepository.js';
import { RemindersRepository } from './remindersRepository.js';

describe('RemindersRepository', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
    await new UsersRepository(await getTestPool()).upsert({ slackUserId: 'U1' });
  });

  it('creates a reminder with open state and initial escalation stage', async () => {
    const repo = new RemindersRepository(await getTestPool());
    const dueAt = new Date('2026-02-01T10:00:00.000Z');
    const reminder = await repo.create({ ownerSlackUserId: 'U1', title: 'Ship the PR', dueAt });
    expect(reminder.state).toBe('open');
    expect(reminder.escalationStage).toBe('initial');
    expect(reminder.pingsSent).toBe(0);
    expect(reminder.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(reminder.nextNotificationAt!.toISOString()).toBe(dueAt.toISOString());
  });

  it('findById returns null when not found', async () => {
    const repo = new RemindersRepository(await getTestPool());
    expect(await repo.findById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('findDueForNotification returns only open reminders due before the given time', async () => {
    const repo = new RemindersRepository(await getTestPool());
    const due = await repo.create({ ownerSlackUserId: 'U1', title: 'Due now', dueAt: new Date('2026-02-01T10:00:00.000Z') });
    await repo.create({ ownerSlackUserId: 'U1', title: 'Due later', dueAt: new Date('2026-02-02T10:00:00.000Z') });

    const results = await repo.findDueForNotification(new Date('2026-02-01T11:00:00.000Z'));
    expect(results.map((r) => r.id)).toEqual([due.id]);
  });

  it('updateAfterAction persists state, escalation stage, pings, and next notification time', async () => {
    const repo = new RemindersRepository(await getTestPool());
    const reminder = await repo.create({ ownerSlackUserId: 'U1', title: 'Task', dueAt: new Date('2026-02-01T10:00:00.000Z') });
    const updated = await repo.updateAfterAction(reminder.id, {
      state: 'open',
      escalationStage: 'followup_30m',
      pingsSent: 1,
      nextNotificationAt: new Date('2026-02-01T10:30:00.000Z'),
    });
    expect(updated.escalationStage).toBe('followup_30m');
    expect(updated.pingsSent).toBe(1);
    expect(updated.nextNotificationAt!.toISOString()).toBe('2026-02-01T10:30:00.000Z');
  });

  it('updateAfterAction sets nextNotificationAt to null when reminder is done', async () => {
    const repo = new RemindersRepository(await getTestPool());
    const reminder = await repo.create({ ownerSlackUserId: 'U1', title: 'Task', dueAt: new Date('2026-02-01T10:00:00.000Z') });
    const updated = await repo.updateAfterAction(reminder.id, { state: 'done', nextNotificationAt: null });
    expect(updated.state).toBe('done');
    expect(updated.nextNotificationAt).toBeNull();
    const stillDue = await repo.findDueForNotification(new Date('2026-03-01T00:00:00.000Z'));
    expect(stillDue.find((r) => r.id === reminder.id)).toBeUndefined();
  });
});
