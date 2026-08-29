/**
 * Parsing for Cursor agent transcripts (`~/.cursor/projects/**\/agent-transcripts`).
 *
 * Cursor writes JSONL, one record per line, and appends as a turn progresses.
 * Records we care about:
 *   {"role":"assistant","message":{"content":[{"type":"tool_use","name":"AskQuestion","input":{...}}]}}
 *   {"type":"turn_ended","status":"success"}
 *
 * Note the shape differs from Claude Code's transcripts: `role` sits at the top
 * level and content is nested under `message`.
 */

export type CursorQuestion = {
  /** Rendered one-line text, e.g. `Title — Q: prompt (options: a, b)`. */
  text: string;
  /** Stable identity for the question, used to avoid posting it twice. */
  key: string;
};

type AskQuestionOption = { label?: unknown };
type AskQuestionEntry = { prompt?: unknown; options?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function renderQuestion(input: Record<string, unknown>): string {
  const title = typeof input.title === 'string' ? input.title : '';
  const questions = Array.isArray(input.questions) ? (input.questions as AskQuestionEntry[]) : [];

  // Cursor sometimes emits a partial AskQuestion with options but no prompt
  // (a streaming artifact); those carry no usable text, so drop them.
  const rendered = questions
    .filter((q): q is AskQuestionEntry & { prompt: string } => typeof q.prompt === 'string' && q.prompt !== '')
    .map((q) => {
      const options = Array.isArray(q.options) ? (q.options as AskQuestionOption[]) : [];
      const labels = options
        .map((o) => (typeof o.label === 'string' ? o.label : ''))
        .filter((label) => label !== '');
      const suffix = labels.length > 0 ? ` (options: ${labels.join(', ')})` : '';
      return `Q: ${q.prompt}${suffix}`;
    })
    .join(' ');

  if (rendered === '') return '';
  return title === '' ? rendered : `${title} — ${rendered}`;
}

/**
 * Extracts every AskQuestion in the transcript, in file order.
 *
 * Unlike the `stop` hook this deliberately does NOT scope to the latest turn:
 * the watcher tails a growing file and wants each question exactly once, as it
 * appears. Duplicate suppression is by `key`, not by position.
 */
export function extractQuestions(contents: string, sessionId: string): CursorQuestion[] {
  const questions: CursorQuestion[] = [];

  contents.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || !trimmed.includes('AskQuestion')) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A partially-flushed final line is normal while Cursor is writing.
      return;
    }

    if (!isRecord(parsed) || parsed.role !== 'assistant') return;
    const message = isRecord(parsed.message) ? parsed.message : undefined;
    const content = message && Array.isArray(message.content) ? message.content : [];

    content.forEach((block, blockIndex) => {
      if (!isRecord(block)) return;
      if (block.type !== 'tool_use' || block.name !== 'AskQuestion') return;
      if (!isRecord(block.input)) return;

      const text = renderQuestion(block.input);
      if (text === '') return;

      questions.push({ text, key: `${sessionId}:${index}:${blockIndex}` });
    });
  });

  return questions;
}

/** True once the transcript's last non-empty record marks the turn complete. */
export function isTurnEnded(contents: string): boolean {
  const lines = contents.split('\n').filter((line) => line.trim() !== '');
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(last);
    return isRecord(parsed) && parsed.type === 'turn_ended';
  } catch {
    return false;
  }
}

/** Derives the session id Cursor uses, which is the transcript's basename. */
export function sessionIdFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  return base.replace(/\.jsonl$/, '');
}
