import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { ScheduledJobsRepository } from '../db/scheduledJobsRepository.js';
import { fakeClock } from '../domain/clock.js';
import { PostgresJobScheduler } from './postgresJobScheduler.js';

describe('PostgresJobScheduler', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
  });

  it('runs a due job through its registered handler and marks it done', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const clock = fakeClock(new Date('2026-02-01T10:00:00.000Z'));
    const scheduler = new PostgresJobScheduler(repo, clock);
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.registerHandler('reminder.send', handler);

    await scheduler.schedule('reminder.send', new Date('2026-02-01T09:59:00.000Z'), { reminderId: 'abc' });
    await scheduler.tick();

    expect(handler).toHaveBeenCalledWith({ reminderId: 'abc' });
    const remaining = await repo.claimDueJobs(new Date('2026-02-01T10:00:00.000Z'), 10);
    expect(remaining.length).toBe(0);
  });

  it('does not run a job scheduled in the future', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const clock = fakeClock(new Date('2026-02-01T10:00:00.000Z'));
    const scheduler = new PostgresJobScheduler(repo, clock);
    const handler = vi.fn().mockResolvedValue(undefined);
    scheduler.registerHandler('reminder.send', handler);

    await scheduler.schedule('reminder.send', new Date('2026-02-01T11:00:00.000Z'), {});
    await scheduler.tick();

    expect(handler).not.toHaveBeenCalled();
  });

  it('marks a job dead_letter after the handler throws past max attempts', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const clock = fakeClock(new Date('2026-02-01T10:00:00.000Z'));
    const scheduler = new PostgresJobScheduler(repo, clock, { maxAttempts: 1 });
    scheduler.registerHandler('reminder.send', async () => {
      throw new Error('handler exploded');
    });

    await scheduler.schedule('reminder.send', new Date('2026-02-01T09:59:00.000Z'), {});
    await scheduler.tick();

    const rows = await (await getTestPool()).query("select status, last_error from scheduled_jobs where kind = 'reminder.send'");
    expect(rows.rows[0].status).toBe('dead_letter');
    expect(rows.rows[0].last_error).toBe('handler exploded');
  });

  it('does not double-schedule when the same dedupeKey is used twice', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const clock = fakeClock(new Date('2026-02-01T10:00:00.000Z'));
    const scheduler = new PostgresJobScheduler(repo, clock);
    scheduler.registerHandler('reminder.send', async () => {});

    await scheduler.schedule('reminder.send', new Date('2026-02-01T09:59:00.000Z'), {}, 'reminder:abc');
    await scheduler.schedule('reminder.send', new Date('2026-02-01T09:59:30.000Z'), {}, 'reminder:abc');

    const claimed = await repo.claimDueJobs(new Date('2026-02-01T10:00:00.000Z'), 10);
    expect(claimed.length).toBe(1);
  });
});
