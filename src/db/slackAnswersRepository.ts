import type { Pool } from 'pg';

export type SlackAnswerStatus = 'pending' | 'answered';

export type SlackAnswer = {
  id: string;
  sessionId: string;
  threadTs: string | null;
  question: string | null;
  answer: string | null;
  status: SlackAnswerStatus;
  createdAt: Date;
  answeredAt: Date | null;
};

type Row = {
  id: string;
  session_id: string;
  thread_ts: string | null;
  question: string | null;
  answer: string | null;
  status: SlackAnswerStatus;
  created_at: Date;
  answered_at: Date | null;
};

function toAnswer(row: Row): SlackAnswer {
  return {
    id: row.id,
    sessionId: row.session_id,
    threadTs: row.thread_ts,
    question: row.question,
    answer: row.answer,
    status: row.status,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

export class SlackAnswersRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: { sessionId: string; question?: string | null }): Promise<SlackAnswer> {
    const result = await this.pool.query<Row>(
      `insert into slack_answers (session_id, question)
       values ($1, $2)
       returning *`,
      [input.sessionId, input.question ?? null],
    );
    const row = result.rows[0];
    if (!row) throw new Error('insert did not return a row');
    return toAnswer(row);
  }

  /**
   * Inserts a question keyed by `dedupeKey`, returning null when that key was
   * already recorded. Used by the Cursor question watcher, which re-reads the
   * same pending question on every poll and must post it only once.
   */
  async createIfNew(input: {
    sessionId: string;
    question: string;
    dedupeKey: string;
  }): Promise<SlackAnswer | null> {
    const result = await this.pool.query<Row>(
      `insert into slack_answers (session_id, question, dedupe_key)
       values ($1, $2, $3)
       on conflict (dedupe_key) where dedupe_key is not null do nothing
       returning *`,
      [input.sessionId, input.question, input.dedupeKey],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }

  async setThreadTs(id: string, threadTs: string): Promise<void> {
    await this.pool.query('update slack_answers set thread_ts = $2 where id = $1', [id, threadTs]);
  }

  async recordAnswer(threadTs: string, answer: string): Promise<SlackAnswer | null> {
    const result = await this.pool.query<Row>(
      `update slack_answers
       set answer = $2, status = 'answered', answered_at = now()
       where thread_ts = $1 and status = 'pending'
       returning *`,
      [threadTs, answer],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }

  async findLatestForSession(sessionId: string): Promise<SlackAnswer | null> {
    const result = await this.pool.query<Row>(
      `select * from slack_answers
       where session_id = $1
       order by created_at desc
       limit 1`,
      [sessionId],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }
}
