import pg from 'pg';
import { loadEnv } from '../../src/config/env.js';

let pool: pg.Pool | undefined;

export async function getTestPool(): Promise<pg.Pool> {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}

export async function truncateAll(p: pg.Pool): Promise<void> {
  await p.query(
    'TRUNCATE TABLE reminder_deliveries, reminders, scheduled_jobs, users RESTART IDENTITY CASCADE',
  );
}
