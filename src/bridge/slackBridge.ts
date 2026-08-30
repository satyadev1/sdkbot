import { SocketModeClient } from '@slack/socket-mode';
import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { postSlackMessage } from '../slack/postMessage.js';

type SlackMessageEvent = {
  type: string;
  subtype?: string;
  text?: string;
  thread_ts?: string;
  bot_id?: string;
  channel?: string;
};

export type BridgeDeps = {
  /**
   * Bot token used only to post the threaded acknowledgement. Without it the
   * bridge still records answers; it just cannot confirm them in Slack.
   */
  botToken?: string;
  postMessage?: (
    botToken: string,
    channelId: string,
    text: string,
    options?: { threadTs?: string },
  ) => Promise<string>;
  log?: (message: string) => void;
};

/**
 * Confirms in-thread that a reply was stored.
 *
 * Without this, answering in Slack is a silent act: the reply lands in Postgres
 * and nothing in Slack changes, so there is no way to tell a recorded answer
 * from one the bridge never saw.
 */
function ackText(answer: string): string {
  const trimmed = answer.trim();
  const shown = trimmed.length > 80 ? `${trimmed.slice(0, 79)}…` : trimmed;
  return `:white_check_mark: recorded: \`${shown}\``;
}

export function startSlackBridge(
  appToken: string,
  repo: SlackAnswersRepository,
  deps: BridgeDeps = {},
): SocketModeClient {
  const client = new SocketModeClient({ appToken });
  const post = deps.postMessage ?? postSlackMessage;
  const log = deps.log ?? ((message: string) => console.log(message));

  client.on('message', async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
    await ack();
    // `bot_id` also filters our own acknowledgement, so it cannot feed back in.
    if (event.bot_id || event.subtype || !event.thread_ts || !event.text) {
      return;
    }
    const answered = await repo.recordAnswer(event.thread_ts, event.text);
    if (!answered) return;
    log(`Recorded answer for session ${answered.sessionId}: ${answered.answer}`);

    if (!deps.botToken || !event.channel) return;
    try {
      await post(deps.botToken, event.channel, ackText(event.text), {
        threadTs: event.thread_ts,
      });
    } catch (err) {
      // The answer is already stored; a failed ack must not lose it.
      log(`ack failed for ${answered.sessionId}: ${err instanceof Error ? err.message : err}`);
    }
  });

  return client;
}
