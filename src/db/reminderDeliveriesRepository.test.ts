import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { UsersRepository } from './usersRepository.js';
import { RemindersRepository } from './remindersRepository.js';
import { ReminderDeliveriesRepository } from './reminderDeliveriesRepository.js';

describe('ReminderDeliveriesRepository', () => {
  let reminderId: string;
  let ownerSlackUserId: string;

  beforeEach(async () => {
    const pool = await getTestPool();
    await truncateAll(pool);
    ownerSlackUserId = 'U1';
    await new UsersRepository(pool).upsert({ slackUserId: ownerSlackUserId });
    const reminder = await new RemindersRepository(pool).create({
      ownerSlackUserId,
      title: 'Task',
      dueAt: new Date('2026-02-01T10:00:00.000Z'),
    });
    reminderId = reminder.id;
  });

  it('records a delivery', async () => {
    const repo = new ReminderDeliveriesRepository(await getTestPool());
    const delivery = await repo.record({ reminderId, kind: 'initial', slackMessageTs: '123.456' });
    expect(delivery.kind).toBe('initial');
    expect(delivery.actionTaken).toBeNull();
    expect(delivery.slackMessageTs).toBe('123.456');
  });

  it('recordAction sets actionTaken on an existing delivery', async () => {
    const repo = new ReminderDeliveriesRepository(await getTestPool());
    const delivery = await repo.record({ reminderId, kind: 'initial' });
    const updated = await repo.recordAction(delivery.id, 'done');
    expect(updated.actionTaken).toBe('done');
  });

  it('countForReminder counts all deliveries for a reminder', async () => {
    const repo = new ReminderDeliveriesRepository(await getTestPool());
    await repo.record({ reminderId, kind: 'initial' });
    await repo.record({ reminderId, kind: 'followup' });
    expect(await repo.countForReminder(reminderId)).toBe(2);
  });

  it('countForUserToday counts deliveries sent today for reminders owned by the user', async () => {
    const repo = new ReminderDeliveriesRepository(await getTestPool());
    await repo.record({ reminderId, kind: 'initial' });
    const count = await repo.countForUserToday(ownerSlackUserId, new Date());
    expect(count).toBe(1);
  });
});
