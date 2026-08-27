import pg from 'pg';
import { loadEnv } from '../config/env.js';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const env = loadEnv();
    pool = new pg.Pool({ connectionString: env.databaseUrl });
  }
  return pool;
}
