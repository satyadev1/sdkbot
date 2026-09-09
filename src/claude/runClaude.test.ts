import { describe, expect, it } from 'vitest';
import { runClaude } from './runClaude.js';

type Call = { file: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };

function harness(result: { stdout?: string; throws?: unknown } = {}) {
  const calls: Call[] = [];
  const exec = async (
    file: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => {
    calls.push({ file, args, env: options.env, cwd: options.cwd });
    if (result.throws) throw result.throws;
    return { stdout: result.stdout ?? '{"result":"ok"}', stderr: '' };
  };
  return { calls, exec };
}

describe('runClaude', () => {
  it('passes the prompt as a single argv entry, never through a shell', async () => {
    const { calls, exec } = harness();
    // Shell metacharacters must survive verbatim: proof they are not parsed.
    const nasty = 'what is $(whoami) && rm -rf / `id`';
    await runClaude(nasty, { sessionId: 's-1' }, { exec });

    expect(calls[0]?.file).toBe('claude');
    expect(calls[0]?.args).toContain(nasty);
    expect(calls[0]?.args.filter((a) => a === nasty)).toHaveLength(1);
  });

  it('strips ANTHROPIC_LOG so debug output cannot corrupt the JSON', async () => {
    const original = process.env.ANTHROPIC_LOG;
    process.env.ANTHROPIC_LOG = 'debug';
    try {
      const { calls, exec } = harness();
      await runClaude('hi', { sessionId: 's-1' }, { exec });
      expect(calls[0]?.env.ANTHROPIC_LOG).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.ANTHROPIC_LOG;
      else process.env.ANTHROPIC_LOG = original;
    }
  });

  it('always runs read-only', async () => {
    const { calls, exec } = harness();
    await runClaude('hi', { sessionId: 's-1' }, { exec });
    const args = calls[0]?.args ?? [];
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan');
  });

  it('creates the session first, then resumes it', async () => {
    const { calls, exec } = harness();
    await runClaude('a', { sessionId: 's-1' }, { exec });
    await runClaude('b', { sessionId: 's-1', resume: true }, { exec });

    expect(calls[0]?.args).toContain('--session-id');
    expect(calls[0]?.args).not.toContain('--resume');
    expect(calls[1]?.args).toContain('--resume');
  });

  it('returns the result and session id from the JSON', async () => {
    const { exec } = harness({ stdout: '{"result":"4","session_id":"s-9"}' });
    const outcome = await runClaude('2+2', { sessionId: 's-1' }, { exec });
    expect(outcome).toEqual({ ok: true, result: '4', sessionId: 's-9' });
  });

  it('fails when the CLI reports an error', async () => {
    const { exec } = harness({ stdout: '{"is_error":true,"result":"nope"}' });
    const outcome = await runClaude('x', { sessionId: 's-1' }, { exec });
    expect(outcome).toEqual({ ok: false, error: 'nope' });
  });

  it('fails cleanly on unparseable output instead of throwing', async () => {
    const { exec } = harness({ stdout: 'DEBUG http request...' });
    const outcome = await runClaude('x', { sessionId: 's-1' }, { exec });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.error).toContain('could not parse');
  });

  it('reports a timeout distinctly', async () => {
    const { exec } = harness({ throws: { killed: true, message: 'Command failed' } });
    const outcome = await runClaude('x', { sessionId: 's-1' }, { exec });
    expect(outcome).toEqual({ ok: false, error: 'claude timed out' });
  });

  it('surfaces stderr rather than the useless "Command failed"', async () => {
    const { exec } = harness({ throws: { stderr: 'boom: bad flag', message: 'Command failed' } });
    const outcome = await runClaude('x', { sessionId: 's-1' }, { exec });
    expect(outcome).toEqual({ ok: false, error: 'boom: bad flag' });
  });
});
