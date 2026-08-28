import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { startSlackBridge } from '../bridge/slackBridge.js';

const env = loadEnv();
if (!env.slackAppToken) {
  console.error('SLACK_APP_TOKEN is not configured; cannot start the Slack bridge.');
  process.exit(1);
}

const pool = getPool();
const repo = new SlackAnswersRepository(pool);
const client = startSlackBridge(env.slackAppToken, repo);

await client.start();
console.log('sdkbot Slack bridge connected (Socket Mode)');
