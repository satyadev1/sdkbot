import { runner } from 'node-pg-migrate';
import { loadEnv } from '../config/env.js';

async function main() {
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    console.error('Usage: tsx src/db/migrate.ts <up|down>');
    process.exit(1);
  }
  const env = loadEnv();
  await runner({
    databaseUrl: env.databaseUrl,
    dir: 'migrations',
    direction,
    migrationsTable: 'pgmigrations',
    count: direction === 'down' ? 1 : Infinity,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
