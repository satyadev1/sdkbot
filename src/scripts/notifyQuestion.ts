import { loadEnv } from '../config/env.js';
import { getPool } from '../db/client.js';
import { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { mentionConfigFromEnv, mentionPrefix } from '../slack/mention.js';
import { postSlackMessage } from '../slack/postMessage.js';
import { sendSlackNotification } from '../slack/notifier.js';

async function main() {
  const sessionId = process.argv[2] ?? '';
  const question = process.argv[3] ?? '';
  if (!sessionId || !question) {
    console.error('Usage: notifyQuestion.ts <session-id> <question> [label]');
    process.exit(1);
  }
  const label = process.argv[4] || `Claude Code (session \`${sessionId}\`)`;

  const env = loadEnv();
  const time = new Date().toLocaleString();
  const tag = mentionPrefix(mentionConfigFromEnv(env), 'question');
  const text = `${tag}:question: *${label} is waiting for your answer* _at ${time}_\n>${question}\n_Reply in this thread to answer._`;

  if (!env.slackBotToken || !env.slackChannelId) {
    if (env.slackWebhookUrl) {
      await sendSlackNotification(env.slackWebhookUrl, text);
    }
    return;
  }

  const pool = getPool();
  const repo = new SlackAnswersRepository(pool);
  const row = await repo.create({ sessionId, question });
  const ts = await postSlackMessage(env.slackBotToken, env.slackChannelId, text);
  await repo.setThreadTs(row.id, ts);
  await pool.end();
}

main().catch((err) => {
  console.error('notifyQuestion failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
