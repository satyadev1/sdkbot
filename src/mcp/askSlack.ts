import type { AppEnv } from '../config/env.js';
import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { mentionConfigFromEnv, mentionPrefix } from '../slack/mention.js';
import { postSlackMessage } from '../slack/postMessage.js';

const POLL_INTERVAL_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type AskSlackDeps = {
  env: AppEnv;
  repo: SlackAnswersRepository;
  post?: typeof postSlackMessage;
  sleep?: (ms: number) => Promise<void>;
  /** Wall-clock cap so a forgotten question can't block a session forever. */
  timeoutMs?: number;
};

export type AskSlackResult =
  | { answered: true; answer: string }
  | { answered: false; reason: 'timed_out' };

/**
 * Posts `question` to Slack (threaded, so a reply can be matched back) and
 * blocks until that thread gets a reply, or `timeoutMs` elapses.
 *
 * This is the tool body behind the `ask_slack` MCP tool: it replaces
 * `AskUserQuestion` for a session that wants the reply delivered back into
 * the same turn, rather than typed in by hand.
 */
export async function askSlack(
  sessionId: string,
  question: string,
  deps: AskSlackDeps,
): Promise<AskSlackResult> {
  const { env, repo } = deps;
  const post = deps.post ?? postSlackMessage;
  const sleepFn = deps.sleep ?? sleep;
  const timeoutMs = deps.timeoutMs ?? 25 * 60 * 60 * 1000; // under the ~28h MCP tool ceiling

  if (!env.slackBotToken || !env.slackChannelId) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_CHANNEL_ID must be set to use ask_slack');
  }

  const tag = mentionPrefix(mentionConfigFromEnv(env), 'question');
  const text = `${tag}:question: *Claude Code (session \`${sessionId}\`) is waiting for your answer*\n>${question}\n_Reply in this thread to answer._`;

  const row = await repo.create({ sessionId, question });
  const ts = await post(env.slackBotToken, env.slackChannelId, text);
  await repo.setThreadTs(row.id, ts);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = await repo.findLatestForSession(sessionId);
    if (latest?.id === row.id && latest.status === 'answered') {
      return { answered: true, answer: latest.answer ?? '' };
    }
    if (Date.now() >= deadline) {
      return { answered: false, reason: 'timed_out' };
    }
    await sleepFn(POLL_INTERVAL_MS);
  }
}
