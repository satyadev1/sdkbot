import type { AppEnv } from '../config/env.js';
import { mentionConfigFromEnv, mentionPrefix } from '../slack/mention.js';
import { postSlackMessage } from '../slack/postMessage.js';

export type NotifySlackDeps = {
  env: AppEnv;
  post?: typeof postSlackMessage;
};

/** Posts a one-way notice to the private notices channel. Does not wait. */
export async function notifySlack(message: string, deps: NotifySlackDeps): Promise<string> {
  const { env } = deps;
  const post = deps.post ?? postSlackMessage;
  if (!env.slackBotToken || !env.slackNoticeChannelId) {
    throw new Error('SLACK_BOT_TOKEN and SLACK_NOTICE_CHANNEL_ID must be set to use notify_slack');
  }
  const tag = mentionPrefix(mentionConfigFromEnv(env), 'notice');
  return post(env.slackBotToken, env.slackNoticeChannelId, `${tag}:bell: ${message}`);
}
