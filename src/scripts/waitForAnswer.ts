import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const sessionId = process.argv[2] ?? '';
  if (!sessionId) {
    console.error('Usage: npm run wait-answer -- <session-id>');
    process.exit(1);
  }

  loadEnv();
  const pool = getPool();
  const repo = new SlackAnswersRepository(pool);

  console.log(`Waiting for a Slack answer for session ${sessionId}... (Ctrl-C to give up)`);
  for (;;) {
    const row = await repo.findLatestForSession(sessionId);
    if (row?.status === 'answered') {
      console.log(row.answer);
      await pool.end();
      process.exit(0);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('wait-answer failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
