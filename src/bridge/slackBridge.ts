import { SocketModeClient } from '@slack/socket-mode';
import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { postSlackMessage } from '../slack/postMessage.js';
import { resolveAnswer } from '../slack/resolveAnswer.js';

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
function clip(value: string, max = 80): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Shows what was stored, and — when a terse reply picked an option — what that
 * reply was taken to mean, so a mis-resolved `1` is caught immediately rather
 * than acted on silently.
 */
function ackText(reply: string, stored: string): string {
  const shown = clip(reply);
  const resolved = clip(stored);
  // Compare after clipping: a long reply stored verbatim is the same answer,
  // so it should not render as though it resolved to something else.
  if (resolved === shown) return `:white_check_mark: recorded: \`${shown}\``;
  return `:white_check_mark: recorded: \`${shown}\` → *${resolved}*`;
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
    const answered = await repo.recordAnswer(
      event.thread_ts,
      event.text,
      (question, reply) => resolveAnswer(question, reply).value,
    );
    if (!answered) return;
    log(`Recorded answer for session ${answered.sessionId}: ${answered.answer}`);

    if (!deps.botToken || !event.channel) return;
    try {
      await post(deps.botToken, event.channel, ackText(event.text, answered.answer ?? event.text), {
        threadTs: event.thread_ts,
      });
    } catch (err) {
      // The answer is already stored; a failed ack must not lose it.
      log(`ack failed for ${answered.sessionId}: ${err instanceof Error ? err.message : err}`);
    }
  });

  return client;
}
