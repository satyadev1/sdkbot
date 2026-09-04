import type { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { escapeHtml, postTelegramMessage } from './sendMessage.js';

type TelegramMessage = {
  message_id: number;
  chat: { id: number };
  text?: string;
  reply_to_message?: { message_id: number };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramBridgeDeps = {
  postMessage?: (
    botToken: string,
    chatId: string,
    text: string,
    options?: { replyToMessageId?: number; html?: boolean },
  ) => Promise<number>;
  fetchUpdates?: (botToken: string, offset: number) => Promise<TelegramUpdate[]>;
  log?: (message: string) => void;
  /** Polling stops once this returns true; checked between long-poll calls. */
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_DELAY_MS = 5000;

function clip(value: string, max = 80): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

async function defaultFetchUpdates(botToken: string, offset: number): Promise<TelegramUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
  url.searchParams.set('timeout', '30');
  url.searchParams.set('offset', String(offset));
  const response = await fetch(url, { method: 'GET' });
  const body = (await response.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
  if (!response.ok || !body.ok) {
    throw new Error(`Telegram getUpdates failed: ${body.description ?? response.status}`);
  }
  return body.result ?? [];
}

/**
 * Long-polls Telegram's Bot API for replies and records them against the
 * pending question they were sent in reply to. Runs until `shouldStop()`
 * returns true (default: never), so callers typically just start it and
 * leave the process running, same as `startSlackBridge`.
 */
export async function startTelegramBridge(
  botToken: string,
  repo: TelegramAnswersRepository,
  deps: TelegramBridgeDeps = {},
): Promise<void> {
  const post = deps.postMessage ?? postTelegramMessage;
  const fetchUpdates = deps.fetchUpdates ?? defaultFetchUpdates;
  const log = deps.log ?? ((message: string) => console.log(message));
  const shouldStop = deps.shouldStop ?? (() => false);
  const sleepFn = deps.sleep ?? sleep;

  let offset = 0;
  while (!shouldStop()) {
    let updates: TelegramUpdate[];
    try {
      updates = await fetchUpdates(botToken, offset);
    } catch (err) {
      // A single network blip (DNS hiccup, connect timeout) must not kill a
      // long-running bridge process — log and retry after a short backoff.
      log(`getUpdates failed, retrying: ${err instanceof Error ? err.message : err}`);
      await sleepFn(RETRY_DELAY_MS);
      continue;
    }
    for (const update of updates) {
      offset = update.update_id + 1;
      const message = update.message;
      const replyToId = message?.reply_to_message?.message_id;
      if (!message || !replyToId || !message.text) continue;

      const answered = await repo.recordAnswer(replyToId, message.text);
      if (!answered) continue;
      log(`Recorded answer for session ${answered.sessionId}: ${answered.answer}`);

      try {
        await post(
          botToken,
          String(message.chat.id),
          `✅ recorded: <code>${escapeHtml(clip(message.text))}</code>`,
          { replyToMessageId: message.message_id, html: true },
        );
      } catch (err) {
        // The answer is already stored; a failed ack must not lose it.
        log(`ack failed for ${answered.sessionId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
