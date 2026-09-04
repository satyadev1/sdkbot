import type { Pool } from 'pg';

export type TelegramAnswerStatus = 'pending' | 'answered';

export type TelegramAnswer = {
  id: string;
  sessionId: string;
  messageId: number | null;
  question: string | null;
  answer: string | null;
  status: TelegramAnswerStatus;
  dedupeKey: string | null;
  createdAt: Date;
  answeredAt: Date | null;
};

type Row = {
  id: string;
  session_id: string;
  message_id: string | null;
  question: string | null;
  answer: string | null;
  status: TelegramAnswerStatus;
  dedupe_key: string | null;
  created_at: Date;
  answered_at: Date | null;
};

function toAnswer(row: Row): TelegramAnswer {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id === null ? null : Number(row.message_id),
    question: row.question,
    answer: row.answer,
    status: row.status,
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

export class TelegramAnswersRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: { sessionId: string; question?: string | null }): Promise<TelegramAnswer> {
    const result = await this.pool.query<Row>(
      `insert into telegram_answers (session_id, question)
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
  }): Promise<TelegramAnswer | null> {
    const result = await this.pool.query<Row>(
      `insert into telegram_answers (session_id, question, dedupe_key)
       values ($1, $2, $3)
       on conflict (dedupe_key) where dedupe_key is not null do nothing
       returning *`,
      [input.sessionId, input.question, input.dedupeKey],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }

  async setMessageId(id: string, messageId: number): Promise<void> {
    await this.pool.query('update telegram_answers set message_id = $2 where id = $1', [
      id,
      messageId,
    ]);
  }

  async recordAnswer(messageId: number, answer: string): Promise<TelegramAnswer | null> {
    const result = await this.pool.query<Row>(
      `update telegram_answers
       set answer = $2, status = 'answered', answered_at = now()
       where message_id = $1 and status = 'pending'
       returning *`,
      [messageId, answer],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }

  async findLatestForSession(sessionId: string): Promise<TelegramAnswer | null> {
    const result = await this.pool.query<Row>(
      `select * from telegram_answers
       where session_id = $1
       order by created_at desc
       limit 1`,
      [sessionId],
    );
    const row = result.rows[0];
    return row ? toAnswer(row) : null;
  }
}
