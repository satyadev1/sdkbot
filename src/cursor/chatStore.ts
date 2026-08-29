import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Reads pending questions from Cursor's live chat store.
 *
 * Cursor buffers agent transcripts and flushes them only when a turn ends, so
 * a transcript watcher can never see a question before it has been answered.
 * The chat store is different: each tool call is persisted the moment it
 * starts, with `toolFormerData.status = "loading"`, and updated to
 * `completed`/`cancelled`/`error` once resolved. A pending `ask_question` is
 * therefore visible while the user is still looking at it.
 *
 * Access notes:
 * - The DB is ~1.7GB, so only indexed lookups are viable. `cursorDiskKV.key`
 *   has a unique index, and bubble keys are `bubbleId:<sessionId>:<bubbleId>`,
 *   so a key range scoped to one session is fast (~10ms). A `value LIKE` scan
 *   across the whole table takes ~4s — far too slow to poll.
 * - Opened with `immutable=1`: read-only, no locking, no WAL recovery, so we
 *   never interfere with Cursor writing to it.
 */

const execFileAsync = promisify(execFile);

export type PendingQuestion = {
  sessionId: string;
  bubbleId: string;
  /** Rendered one-line text, e.g. `Q: prompt (options: a, b)`. */
  text: string;
  /** Workspace id, used to resolve a human-readable folder name. */
  workspaceId: string;
  /** Stable identity for dedupe: one Slack post per question bubble. */
  key: string;
};

type SqliteRunner = (dbPath: string, sql: string) => Promise<string>;

/** ASCII unit/record separators: never appear unescaped in JSON payloads. */
const COL = '\x1f';
const ROW = '\x1e';

const defaultRunner: SqliteRunner = async (dbPath, sql) => {
  // `immutable=1` needs the URI form; -readonly alone would still touch the WAL.
  const { stdout } = await execFileAsync(
    'sqlite3',
    ['-separator', COL, '-newline', ROW, `file:${dbPath}?immutable=1`, sql],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
};

export function defaultChatDbPath(): string {
  return join(
    homedir(),
    'Library',
    'Application Support',
    'Cursor',
    'User',
    'globalStorage',
    'state.vscdb',
  );
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Rejects anything that could break the key-range predicates below. */
function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(id);
}

type QuestionEntry = { prompt?: unknown; options?: unknown };

/**
 * Renders `toolFormerData.params` into one line. Mirrors the transcript
 * renderer: Cursor uses the same `{questions:[{prompt,options}]}` shape here.
 */
export function renderParams(paramsJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';

  const record = parsed as Record<string, unknown>;
  const questions = Array.isArray(record.questions) ? (record.questions as QuestionEntry[]) : [];

  return questions
    .filter((q): q is QuestionEntry & { prompt: string } =>
      typeof q.prompt === 'string' && q.prompt !== '',
    )
    .map((q) => {
      const options = Array.isArray(q.options) ? q.options : [];
      const labels = options
        .map((o) =>
          typeof o === 'object' && o !== null && typeof (o as { label?: unknown }).label === 'string'
            ? (o as { label: string }).label
            : '',
        )
        .filter((label) => label !== '');
      const suffix = labels.length > 0 ? ` (options: ${labels.join(', ')})` : '';
      return `Q: ${q.prompt}${suffix}`;
    })
    .join(' ');
}

export type RecentSession = { composerId: string; workspaceId: string; recency: number };

/**
 * Recently-touched chat sessions, newest first. Backed by an index on
 * `recency`, so this stays cheap regardless of history size.
 */
export async function recentSessions(
  dbPath: string,
  limit = 12,
  run: SqliteRunner = defaultRunner,
): Promise<RecentSession[]> {
  const sql =
    `select composerId, coalesce(workspaceId,''), recency from composerHeaders ` +
    `order by recency desc limit ${Math.max(1, Math.floor(limit))};`;
  const stdout = await run(dbPath, sql);

  return stdout
    .split(ROW)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [composerId = '', workspaceId = '', recency = '0'] = line.split(COL);
      return { composerId, workspaceId, recency: Number(recency) || 0 };
    })
    .filter((session) => isSafeId(session.composerId));
}

/**
 * Finds `ask_question` bubbles for one session that are still awaiting an
 * answer (`status = "loading"`).
 */
export async function pendingQuestionsForSession(
  dbPath: string,
  session: RecentSession,
  run: SqliteRunner = defaultRunner,
): Promise<PendingQuestion[]> {
  if (!isSafeId(session.composerId)) return [];

  // `;` is the next byte after `:`, so this is a prefix range over the index.
  const lower = quote(`bubbleId:${session.composerId}:`);
  const upper = quote(`bubbleId:${session.composerId};`);
  const sql =
    `select key, value from cursorDiskKV ` +
    `where key >= ${lower} and key < ${upper} and value like '%ask_question%';`;

  const stdout = await run(dbPath, sql);
  const questions: PendingQuestion[] = [];

  for (const line of stdout.split(ROW)) {
    const sep = line.indexOf(COL);
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const raw = line.slice(sep + 1);
    if (key === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;

    const tool = (parsed as { toolFormerData?: unknown }).toolFormerData;
    if (typeof tool !== 'object' || tool === null) continue;
    const data = tool as { name?: unknown; status?: unknown; params?: unknown };

    if (data.name !== 'ask_question') continue;
    // Only "loading" is unanswered; completed/cancelled/error are resolved.
    if (data.status !== 'loading') continue;
    if (typeof data.params !== 'string') continue;

    const text = renderParams(data.params);
    if (text === '') continue;

    const bubbleId = key.slice(`bubbleId:${session.composerId}:`.length);
    questions.push({
      sessionId: session.composerId,
      bubbleId,
      text,
      workspaceId: session.workspaceId,
      key,
    });
  }

  return questions;
}

/** Pending questions across the most recently active sessions. */
export async function findPendingQuestions(
  dbPath: string,
  sessionLimit = 12,
  run: SqliteRunner = defaultRunner,
): Promise<PendingQuestion[]> {
  const sessions = await recentSessions(dbPath, sessionLimit, run);
  const found: PendingQuestion[] = [];
  for (const session of sessions) {
    found.push(...(await pendingQuestionsForSession(dbPath, session, run)));
  }
  return found;
}
