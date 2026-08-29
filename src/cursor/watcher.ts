import type { SlackAnswersRepository } from '../db/slackAnswersRepository.js';
import { postSlackMessage } from '../slack/postMessage.js';
import { defaultChatDbPath, findPendingQuestions, type PendingQuestion } from './chatStore.js';
import { createWorkspaceNameResolver } from './workspaceNames.js';

/**
 * Polls Cursor's chat store and posts questions to Slack while they are still
 * unanswered.
 *
 * Cursor's `stop` hook only fires once a whole turn completes, and its agent
 * transcripts are buffered until then too — both signals arrive after the user
 * has already answered. The chat store persists each tool call as it starts, so
 * a pending `ask_question` is visible immediately. See `chatStore.ts`.
 *
 * The `stop` hook still posts the "finished" notice; this owns questions.
 */

export type WatcherDeps = {
  repo: SlackAnswersRepository;
  botToken: string;
  channelId: string;
  /** Path to Cursor's globalStorage state.vscdb. */
  dbPath?: string;
  intervalMs?: number;
  /** How many recently-active sessions to inspect per poll. */
  sessionLimit?: number;
  resolveWorkspaceName?: (workspaceId: string) => Promise<string>;
  postMessage?: (botToken: string, channelId: string, text: string) => Promise<string>;
  findPending?: (dbPath: string, sessionLimit: number) => Promise<PendingQuestion[]>;
  log?: (message: string) => void;
};

export type CursorWatcher = { stop: () => void };

const DEFAULT_INTERVAL_MS = 2000;

export function startCursorWatcher(deps: WatcherDeps): CursorWatcher {
  const dbPath = deps.dbPath ?? defaultChatDbPath();
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sessionLimit = deps.sessionLimit ?? 12;
  const log = deps.log ?? ((message: string) => console.log(message));
  const resolveWorkspaceName = deps.resolveWorkspaceName ?? createWorkspaceNameResolver();
  const post = deps.postMessage ?? postSlackMessage;
  const findPending =
    deps.findPending ?? ((path: string, limit: number) => findPendingQuestions(path, limit));

  /**
   * Bubble keys already handled in this process. The DB's unique dedupe_key is
   * the durable guard; this avoids a query per poll for known questions.
   */
  const handled = new Set<string>();

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  /**
   * A question that is already on screen when the watcher starts gets recorded
   * without posting. Restarting must not replay questions the user has seen —
   * but note that unlike the old transcript watcher there is no large backlog
   * here, since only *pending* questions are ever returned.
   */
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
      `:question: *{CURSOR} \`${project}\` is waiting for your answer* _at ${time}_\n` +
      `>${question.text}\n_Reply in this thread to answer._`;
    const ts = await post(deps.botToken, deps.channelId, text);
    await deps.repo.setThreadTs(row.id, ts);
    log(`posted cursor question ${shortId}/${question.bubbleId.slice(0, 8)} (${project})`);
  }

  async function poll(): Promise<void> {
    const pending = await findPending(dbPath, sessionLimit);
    for (const question of pending) {
      try {
        await handleQuestion(question);
      } catch (err) {
        // One bad question must not kill the watcher.
        log(`watcher error on ${question.key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async function loop(): Promise<void> {
    if (stopped) return;
    try {
      await poll();
    } catch (err) {
      log(`watcher poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (priming) {
      priming = false;
      log(`watching ${dbPath} (${handled.size} question(s) already pending, ignored)`);
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
