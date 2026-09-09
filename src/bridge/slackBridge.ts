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
  /** Slack member id of the sender; absent on bot posts. */
  user?: string;
  /** This message's own ts, used to thread a reply under it. */
  ts?: string;
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
  /**
   * Inbound commands: a top-level message that @-mentions the bot is run as a
   * Claude prompt and answered in-thread. Both fields are required to enable
   * it, so the path stays off until deliberately configured.
   */
  command?: {
    /** Bot's own member id (`U…`); a message must mention it to be a command. */
    botUserId: string;
    /** Only this member id may issue commands. */
    allowedUserId: string;
    run: (prompt: string) => Promise<{ ok: true; result: string } | { ok: false; error: string }>;
  };
};

/** Strips every `<@U…>` mention, leaving the actual instruction text. */
function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

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

  /**
   * Handles a top-level channel message: runs it as a Claude prompt when it
   * mentions the bot and comes from the allowed user.
   *
   * Unmentioned chatter is logged but not answered — the bot shares the channel
   * with ordinary conversation and must not reply to all of it.
   */
  async function handleCommand(event: SlackMessageEvent): Promise<void> {
    const cmd = deps.command;
    const text = event.text ?? '';
    if (!cmd) {
      log(`ignored top-level message (commands not configured): ${clip(text)}`);
      return;
    }
    if (!text.includes(`<@${cmd.botUserId}>`)) {
      log(`ignored top-level message (no mention): ${clip(text)}`);
      return;
    }
    // Authorisation before anything is executed: this is the only thing standing
    // between a channel member and a process on this machine.
    if (event.user !== cmd.allowedUserId) {
      log(`refused command from ${event.user ?? 'unknown'}: ${clip(text)}`);
      await reply(event, ':no_entry: Not authorised to send commands.');
      return;
    }
    const prompt = stripMentions(text);
    if (!prompt) {
      await reply(event, 'Mention me with an instruction, e.g. `@sdk what does runClaude do?`');
      return;
    }

    log(`command from ${event.user}: ${clip(prompt)}`);
    // A turn takes several seconds; without this the channel looks dead.
    await reply(event, ':hourglass_flowing_sand: working…');
    const outcome = await cmd.run(prompt);
    if (outcome.ok) {
      log(`command completed: ${clip(prompt)}`);
      await reply(event, outcome.result);
    } else {
      log(`command failed: ${clip(prompt)} — ${outcome.error}`);
      await reply(event, `:warning: failed: ${outcome.error}`);
    }
  }

  /** Posts under the triggering message; never throws. */
  async function reply(event: SlackMessageEvent, text: string): Promise<void> {
    if (!deps.botToken || !event.channel) return;
    try {
      await post(deps.botToken, event.channel, text, { threadTs: event.ts });
    } catch (err) {
      log(`reply failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  client.on('message', async ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
    await ack();
    // `bot_id` also filters our own acknowledgement, so it cannot feed back in.
    // Both bot identities that post here (bot token and incoming webhook) carry
    // one, so neither can trigger a command.
    if (event.bot_id || event.subtype || !event.text) {
      return;
    }
    // A top-level message is never an answer to a question — answers arrive as
    // thread replies. Previously these were dropped without a trace; now they
    // route to the command path, which at minimum logs them.
    if (!event.thread_ts) {
      await handleCommand(event);
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
