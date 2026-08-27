import type { Clock } from '../domain/clock.js';
import type { ScheduledJobsRepository } from '../db/scheduledJobsRepository.js';
import type { JobHandler, JobScheduler } from './jobScheduler.js';

export class PostgresJobScheduler implements JobScheduler {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly maxAttempts: number;
  private readonly batchSize: number;

  constructor(
    private readonly repo: ScheduledJobsRepository,
    private readonly clock: Clock,
    opts: { maxAttempts?: number; batchSize?: number } = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.batchSize = opts.batchSize ?? 20;
  }

  async schedule(kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey?: string): Promise<void> {
    await this.repo.schedule({ kind, runAt, payload, dedupeKey: dedupeKey ?? null });
  }

  registerHandler(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async tick(): Promise<void> {
    const due = await this.repo.claimDueJobs(this.clock.now(), this.batchSize);
    for (const job of due) {
      const handler = this.handlers.get(job.kind);
      if (!handler) {
        await this.repo.markFailed(job.id, `no handler registered for kind "${job.kind}"`, this.maxAttempts);
        continue;
      }
      try {
        await handler(job.payload);
        await this.repo.markDone(job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.repo.markFailed(job.id, message, this.maxAttempts);
      }
    }
  }
}
