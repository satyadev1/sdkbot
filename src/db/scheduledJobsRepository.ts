import type { Pool } from 'pg';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'dead_letter';

export type ScheduledJob = {
  id: string;
  kind: string;
  runAt: Date;
  status: JobStatus;
  attempts: number;
  payload: Record<string, unknown>;
  lastError: string | null;
  dedupeKey: string | null;
};

type Row = {
  id: string;
  kind: string;
  run_at: Date;
  status: JobStatus;
  attempts: number;
  payload: Record<string, unknown>;
  last_error: string | null;
  dedupe_key: string | null;
};

function toJob(row: Row): ScheduledJob {
  return {
    id: row.id,
    kind: row.kind,
    runAt: row.run_at,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
    lastError: row.last_error,
    dedupeKey: row.dedupe_key,
  };
}

export class ScheduledJobsRepository {
  constructor(private readonly pool: Pool) {}

  async schedule(input: {
    kind: string;
    runAt: Date;
    payload: Record<string, unknown>;
    dedupeKey?: string | null;
  }): Promise<ScheduledJob | null> {
    const result = await this.pool.query<Row>(
      `insert into scheduled_jobs (kind, run_at, payload, dedupe_key)
       values ($1, $2, $3, $4)
       on conflict (dedupe_key) where dedupe_key is not null and status = 'pending' do nothing
       returning *`,
      [input.kind, input.runAt, input.payload, input.dedupeKey ?? null],
    );
    const row = result.rows[0];
    return row ? toJob(row) : null;
  }

  async claimDueJobs(before: Date, limit: number): Promise<ScheduledJob[]> {
    const result = await this.pool.query<Row>(
      `update scheduled_jobs set status = 'running'
       where id in (
         select id from scheduled_jobs
         where status = 'pending' and run_at <= $1
         order by run_at asc
         limit $2
         for update skip locked
       )
       returning *`,
      [before, limit],
    );
    return result.rows.map(toJob);
  }

  async markDone(id: string): Promise<void> {
    await this.pool.query("update scheduled_jobs set status = 'done' where id = $1", [id]);
  }

  async markFailed(id: string, error: string, maxAttempts: number): Promise<void> {
    await this.pool.query(
      `update scheduled_jobs set
         attempts = attempts + 1,
         last_error = $2,
         status = case when attempts + 1 >= $3 then 'dead_letter' else 'pending' end
       where id = $1`,
      [id, error, maxAttempts],
    );
  }
}
