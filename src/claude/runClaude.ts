import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const run = promisify(execFile);

/** Shape of `claude -p --output-format json`; only the fields we rely on. */
type ClaudeJson = {
  is_error?: boolean;
  result?: string;
  session_id?: string;
};

export type RunClaudeResult =
  | { ok: true; result: string; sessionId?: string }
  | { ok: false; error: string };

export type RunClaudeDeps = {
  /**
   * Injected for tests. Defaults to `promisify(execFile)`, so production never
   * goes through a shell — see the argv note in `runClaude`.
   */
  exec?: (
    file: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
  ) => Promise<{ stdout: string; stderr: string }>;
};

export type RunClaudeOptions = {
  /**
   * Dedicated session id for the bridge. Never pass a *live* session's id:
   * `--resume` against a running session writes into that session's own
   * transcript rather than forking, which corrupts its history.
   */
  sessionId: string;
  /** First call creates the session; later calls resume it to keep context. */
  resume?: boolean;
  timeoutMs?: number;
};

/** Repo root, from this module's location — no machine-specific path. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/**
 * `ANTHROPIC_LOG=debug` makes the CLI dump every HTTP request to stdout, which
 * lands in front of the JSON and makes it unparseable. It is set in some
 * shells, so strip it rather than assuming a clean environment.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_LOG;
  return env;
}

/**
 * Runs one headless Claude turn and returns its answer.
 *
 * Read-only by design: `--permission-mode plan` lets the turn read and reason
 * but not edit files or run commands. The prompt arrives from Slack, so the
 * blast radius of a bad prompt has to stay small.
 */
export async function runClaude(
  prompt: string,
  options: RunClaudeOptions,
  deps: RunClaudeDeps = {},
): Promise<RunClaudeResult> {
  const exec = deps.exec ?? run;
  const timeout = options.timeoutMs ?? 180_000;

  // argv array, never a shell string: the prompt is untrusted input from a
  // Slack message, so it must never be parsed by a shell.
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--permission-mode',
    'plan',
    options.resume ? '--resume' : '--session-id',
    options.sessionId,
  ];

  let stdout: string;
  try {
    ({ stdout } = await exec('claude', args, {
      cwd: repoRoot(),
      env: childEnv(),
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (err) {
    return { ok: false, error: describeExecError(err) };
  }

  let parsed: ClaudeJson;
  try {
    parsed = JSON.parse(stdout) as ClaudeJson;
  } catch {
    // Truncated so a huge stray dump cannot flood the Slack reply.
    return { ok: false, error: `could not parse claude output: ${stdout.slice(0, 300)}` };
  }

  if (parsed.is_error) {
    return { ok: false, error: parsed.result?.slice(0, 500) ?? 'claude reported an error' };
  }
  if (!parsed.result) {
    return { ok: false, error: 'claude returned no result' };
  }
  return { ok: true, result: parsed.result, sessionId: parsed.session_id };
}

/**
 * `execFile` rejections carry the useful detail on `stderr`/`killed`, not in
 * `message` — which is just "Command failed".
 */
function describeExecError(err: unknown): string {
  const e = err as { killed?: boolean; stderr?: string; message?: string };
  if (e?.killed) return 'claude timed out';
  const stderr = e?.stderr?.trim();
  if (stderr) return stderr.slice(-500);
  return e?.message ?? String(err);
}
