import { loadEnv } from './config/env.js';
import { getPool } from './db/client.js';
import { ScheduledJobsRepository } from './db/scheduledJobsRepository.js';
import { systemClock } from './domain/clock.js';
import { PostgresJobScheduler } from './scheduler/postgresJobScheduler.js';
import { sendSlackNotification } from './slack/notifier.js';

const POLL_INTERVAL_MS = 5000;

const env = loadEnv();
const pool = getPool();
const repo = new ScheduledJobsRepository(pool);
const scheduler = new PostgresJobScheduler(repo, systemClock);

scheduler.registerHandler('notify.slack', async (payload) => {
  const message = payload.message;
  if (typeof message !== 'string') {
    throw new Error('notify.slack job payload missing "message" string');
  }
  if (!env.slackWebhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL is not configured');
  }
  await sendSlackNotification(env.slackWebhookUrl, message);
});

setInterval(() => {
  scheduler.tick().catch((err) => console.error('scheduler tick failed:', err));
}, POLL_INTERVAL_MS);

console.log('sdkbot scheduler running');
