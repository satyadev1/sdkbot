import type { TelegramAnswersRepository } from '../db/telegramAnswersRepository.js';
import { escapeHtml, postTelegramMessage } from '../telegram/sendMessage.js';
import { defaultChatDbPath, findPendingQuestions, type PendingQuestion } from './chatStore.js';
import { createWorkspaceNameResolver } from './workspaceNames.js';

/**
 * Polls Cursor's chat store and posts questions to Telegram while they are
 * still unanswered — the Telegram counterpart of `startCursorWatcher`
 * (Slack). Kept as a separate watcher rather than a shared/parametrized one
 * so the working Slack path can never be affected by Telegram-side changes.
 *
 * See `cursor/watcher.ts` for why the chat store (not Cursor's `stop` hook or
 * transcripts) is the right signal source.
 */

export type TelegramWatcherDeps = {
  repo: TelegramAnswersRepository;
  botToken: string;
  chatId: string;
  dbPath?: string;
  intervalMs?: number;
  sessionLimit?: number;
  resolveWorkspaceName?: (workspaceId: string) => Promise<string>;
  postMessage?: (
    botToken: string,
    chatId: string,
    text: string,
    options?: { html?: boolean },
  ) => Promise<number>;
  findPending?: (dbPath: string, sessionLimit: number) => Promise<PendingQuestion[]>;
  log?: (message: string) => void;
};

export type CursorTelegramWatcher = { stop: () => void };

const DEFAULT_INTERVAL_MS = 2000;

export function startCursorTelegramWatcher(deps: TelegramWatcherDeps): CursorTelegramWatcher {
  const dbPath = deps.dbPath ?? defaultChatDbPath();
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sessionLimit = deps.sessionLimit ?? 12;
  const log = deps.log ?? ((message: string) => console.log(message));
  const resolveWorkspaceName = deps.resolveWorkspaceName ?? createWorkspaceNameResolver();
  const post = deps.postMessage ?? postTelegramMessage;
  const findPending =
    deps.findPending ?? ((path: string, limit: number) => findPendingQuestions(path, limit));

  /** Bubble keys already handled in this process; dedupe_key is the durable guard. */
  const handled = new Set<string>();

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  /** Skip questions already on screen when the watcher starts — no replay on restart. */
  let priming = true;

  async function handleQuestion(question: PendingQuestion): Promise<void> {
    if (handled.has(question.key)) return;
    handled.add(question.key);
    if (priming) return;

    const project = await resolveWorkspaceName(question.workspaceId);
    const shortId = question.sessionId.slice(0, 8);

    const row = await deps.repo.createIfNew({
      sessionId: `cursor-${shortId}`,
      question: question.text,
      dedupeKey: question.key,
    });
    // Null means a previous run already posted this bubble.
    if (!row) return;

    const time = new Date().toLocaleString();
    const text =
      `⚫ <b>Cursor question</b>\n` +
      `<code>${escapeHtml(project)}</code> · <i>${escapeHtml(time)}</i>\n\n` +
      `${escapeHtml(question.text)}\n\n` +
      `Reply to this message to answer.`;
    const messageId = await post(deps.botToken, deps.chatId, text, { html: true });
    await deps.repo.setMessageId(row.id, messageId);
    log(`posted cursor question ${shortId}/${question.bubbleId.slice(0, 8)} (${project}) to telegram`);
  }

  async function poll(): Promise<void> {
    const pending = await findPending(dbPath, sessionLimit);
    for (const question of pending) {
      try {
        await handleQuestion(question);
      } catch (err) {
        // One bad question must not kill the watcher.
        log(`telegram watcher error on ${question.key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      await poll();
    } catch (err) {
      log(`telegram watcher poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (priming) {
      priming = false;
      log(`watching ${dbPath} for telegram (${handled.size} question(s) already pending, ignored)`);
    }
    if (!stopped) timer = setTimeout(() => void loop(), intervalMs);
  }

  void loop();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
