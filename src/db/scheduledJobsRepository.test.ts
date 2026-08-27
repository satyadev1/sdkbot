import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { ScheduledJobsRepository } from './scheduledJobsRepository.js';

describe('ScheduledJobsRepository', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
  });

  it('schedules a job', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const job = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: { reminderId: 'abc' } });
    expect(job?.kind).toBe('reminder.send');
    expect(job?.status).toBe('pending');
  });

  it('returns null when scheduling a duplicate pending dedupeKey', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const first = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: {}, dedupeKey: 'reminder:abc' });
    const second = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T11:00:00.000Z'), payload: {}, dedupeKey: 'reminder:abc' });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('claimDueJobs returns only due, pending jobs and marks them running', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const due = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: {} });
    await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-02T10:00:00.000Z'), payload: {} });

    const claimed = await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    expect(claimed.map((j) => j.id)).toEqual([due!.id]);
    expect(claimed[0]?.status).toBe('running');
  });

  it('claimDueJobs does not return already-running jobs twice', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: {} });
    const first = await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    const second = await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    expect(first.length).toBe(1);
    expect(second.length).toBe(0);
  });

  it('markDone sets status to done', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const job = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: {} });
    await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    await repo.markDone(job!.id);
    const claimedAgain = await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    expect(claimedAgain.length).toBe(0);
  });

  it('markFailed increments attempts and moves to dead_letter at max attempts', async () => {
    const repo = new ScheduledJobsRepository(await getTestPool());
    const job = await repo.schedule({ kind: 'reminder.send', runAt: new Date('2026-02-01T10:00:00.000Z'), payload: {} });
    await repo.claimDueJobs(new Date('2026-02-01T12:00:00.000Z'), 10);
    await repo.markFailed(job!.id, 'boom', 1);
    const rows = await (await getTestPool()).query('select status, attempts, last_error from scheduled_jobs where id = $1', [job!.id]);
    expect(rows.rows[0].status).toBe('dead_letter');
    expect(rows.rows[0].attempts).toBe(1);
    expect(rows.rows[0].last_error).toBe('boom');
  });
});
