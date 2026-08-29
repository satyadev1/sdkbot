import { describe, expect, it } from 'vitest';
import { extractQuestions, isTurnEnded, sessionIdFromPath } from './transcript.js';

const askQuestion = (input: unknown) =>
  JSON.stringify({ role: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskQuestion', input }] } });

const assistantText = (text: string) =>
  JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text }] } });

const turnEnded = JSON.stringify({ type: 'turn_ended', status: 'success' });

describe('extractQuestions', () => {
  it('renders prompt and option labels', () => {
    const contents = askQuestion({
      questions: [{ prompt: 'What next?', options: [{ label: 'A' }, { label: 'B' }] }],
    });

    expect(extractQuestions(contents, 's1')[0]?.text).toBe('Q: What next? (options: A, B)');
  });

  it('prefixes the title when present', () => {
    const contents = askQuestion({
      title: 'Scoping',
      questions: [{ prompt: 'Which port?', options: [] }],
    });

    expect(extractQuestions(contents, 's1')[0]?.text).toBe('Scoping — Q: Which port?');
  });

  it('skips partial entries that have options but no prompt', () => {
    // Observed in real transcripts: Cursor emits a promptless AskQuestion
    // alongside the complete one.
    const contents = [
      askQuestion({ questions: [{ options: [{ label: 'A' }] }] }),
      askQuestion({ questions: [{ prompt: 'Real question?', options: [{ label: 'A' }] }] }),
    ].join('\n');

    const questions = extractQuestions(contents, 's1');
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe('Q: Real question? (options: A)');
  });

  it('returns every question across turns, in order', () => {
    const contents = [
      askQuestion({ questions: [{ prompt: 'First?' }] }),
      turnEnded,
      assistantText('some reply'),
      askQuestion({ questions: [{ prompt: 'Second?' }] }),
    ].join('\n');

    expect(extractQuestions(contents, 's1').map((q) => q.text)).toEqual([
      'Q: First?',
      'Q: Second?',
    ]);
  });

  it('assigns distinct keys to identical question text', () => {
    const contents = [
      askQuestion({ questions: [{ prompt: 'Same?' }] }),
      askQuestion({ questions: [{ prompt: 'Same?' }] }),
    ].join('\n');

    const [first, second] = extractQuestions(contents, 's1');
    expect(first?.key).not.toBe(second?.key);
  });

  it('is stable across repeated parses of a growing file', () => {
    const first = askQuestion({ questions: [{ prompt: 'Keep me?' }] });
    const grown = [first, assistantText('later output')].join('\n');

    expect(extractQuestions(first, 's1')[0]?.key).toBe(extractQuestions(grown, 's1')[0]?.key);
  });

  it('ignores a partially written trailing line', () => {
    const contents = [askQuestion({ questions: [{ prompt: 'Done?' }] }), '{"role":"assist'].join('\n');

    expect(extractQuestions(contents, 's1')).toHaveLength(1);
  });

  it('ignores user records and non-AskQuestion tools', () => {
    const contents = [
      JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'AskQuestion' }] } }),
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
      }),
    ].join('\n');

    expect(extractQuestions(contents, 's1')).toEqual([]);
  });
});

describe('isTurnEnded', () => {
  it('is true when the last record ends the turn', () => {
    expect(isTurnEnded([assistantText('hi'), turnEnded].join('\n'))).toBe(true);
  });

  it('is false while the assistant is still writing', () => {
    expect(isTurnEnded([turnEnded, assistantText('hi')].join('\n'))).toBe(false);
  });

  it('tolerates trailing blank lines', () => {
    expect(isTurnEnded(`${turnEnded}\n\n`)).toBe(true);
  });
});

describe('sessionIdFromPath', () => {
  it('uses the transcript basename', () => {
    expect(sessionIdFromPath('/a/b/agent-transcripts/abc-123/abc-123.jsonl')).toBe('abc-123');
  });
});
