/**
 * Turns a terse Slack reply into the option it refers to.
 *
 * Answering a multiple-choice question from a phone invites the shortest
 * possible reply — `1`, or `push`. Stored verbatim, `1` is meaningless later:
 * whoever reads the row has to go find the question to interpret it.
 *
 * Both the Claude Code hook and the Cursor watcher render options into the
 * question text as `... (options: A, B, C)`, so the choices can be recovered
 * from the stored question without a schema change.
 */

/** Options in the order they were offered, or `[]` when the text has none. */
export function parseOptions(question: string | null | undefined): string[] {
  if (!question) return [];
  // Last occurrence: a question body could itself contain "(options:".
  const marker = question.lastIndexOf('(options:');
  if (marker === -1) return [];
  const close = question.indexOf(')', marker);
  if (close === -1) return [];
  return question
    .slice(marker + '(options:'.length, close)
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option !== '');
}

export type ResolvedAnswer = {
  /** What to store: the option label when identified, else the raw reply. */
  value: string;
  /** The option matched, when the reply picked one. */
  matched?: string;
  /** How the match was made — useful for logging and the ack text. */
  via?: 'index' | 'exact' | 'prefix';
};

/**
 * Resolves `reply` against the options offered in `question`.
 *
 * Deliberately conservative: an ambiguous prefix, an out-of-range index, or
 * anything unrecognised is kept verbatim rather than guessed at, since storing
 * the wrong choice is worse than storing a reply that needs a human to read it.
 */
export function resolveAnswer(question: string | null | undefined, reply: string): ResolvedAnswer {
  const raw = reply.trim();
  const options = parseOptions(question);
  if (options.length === 0 || raw === '') return { value: raw };

  // `1` is 1-based, matching how the options read to a person.
  if (/^\d{1,3}$/.test(raw)) {
    const index = Number(raw) - 1;
    const option = options[index];
    return option ? { value: option, matched: option, via: 'index' } : { value: raw };
  }

  const lower = raw.toLowerCase();
  const exact = options.find((option) => option.toLowerCase() === lower);
  if (exact) return { value: exact, matched: exact, via: 'exact' };

  // Only accept a prefix when exactly one option starts with it.
  const prefixed = options.filter((option) => option.toLowerCase().startsWith(lower));
  if (prefixed.length === 1 && prefixed[0]) {
    return { value: prefixed[0], matched: prefixed[0], via: 'prefix' };
  }

  return { value: raw };
}
