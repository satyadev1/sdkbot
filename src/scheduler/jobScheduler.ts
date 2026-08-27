export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

export interface JobScheduler {
  schedule(kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey?: string): Promise<void>;
  registerHandler(kind: string, handler: JobHandler): void;
  tick(): Promise<void>;
}
