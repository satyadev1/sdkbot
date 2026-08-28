import { getPool } from '../db/client.js';
import { ScheduledJobsRepository } from '../db/scheduledJobsRepository.js';

async function main() {
  const message = process.argv.slice(2).join(' ').trim();
  if (!message) {
    console.error('Usage: npm run notify -- "message"');
    process.exit(1);
  }

  const pool = getPool();
  const repo = new ScheduledJobsRepository(pool);
  await repo.schedule({ kind: 'notify.slack', runAt: new Date(), payload: { message } });
  console.log(`Queued Slack notification: "${message}"`);
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to queue notification:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
