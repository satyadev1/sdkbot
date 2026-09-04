import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { TelegramAnswersRepository } from './telegramAnswersRepository.js';

describe('TelegramAnswersRepository', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
  });

  it('creates a pending answer row', async () => {
    const repo = new TelegramAnswersRepository(await getTestPool());
    const row = await repo.create({ sessionId: 'abc12345', question: 'proceed?' });
    expect(row.status).toBe('pending');
    expect(row.messageId).toBeNull();
  });

  it('recordAnswer matches by messageId and flips status to answered', async () => {
    const repo = new TelegramAnswersRepository(await getTestPool());
    const row = await repo.create({ sessionId: 'abc12345', question: 'proceed?' });
    await repo.setMessageId(row.id, 42);

    const answered = await repo.recordAnswer(42, 'yes go ahead');
    expect(answered?.status).toBe('answered');
    expect(answered?.answer).toBe('yes go ahead');
  });

  it('recordAnswer returns null when no pending row matches the messageId', async () => {
    const repo = new TelegramAnswersRepository(await getTestPool());
    const result = await repo.recordAnswer(999, 'yes');
    expect(result).toBeNull();
  });

  it('findLatestForSession returns the most recently created row for that session', async () => {
    const repo = new TelegramAnswersRepository(await getTestPool());
    await repo.create({ sessionId: 'abc12345', question: 'first?' });
    const second = await repo.create({ sessionId: 'abc12345', question: 'second?' });

    const latest = await repo.findLatestForSession('abc12345');
    expect(latest?.id).toBe(second.id);
  });

  it('createIfNew inserts once per dedupeKey and returns null on repeat', async () => {
    const repo = new TelegramAnswersRepository(await getTestPool());
    const first = await repo.createIfNew({
      sessionId: 'cursor-abc123',
      question: 'proceed?',
      dedupeKey: 'bubble-1',
    });
    expect(first?.status).toBe('pending');

    const repeat = await repo.createIfNew({
      sessionId: 'cursor-abc123',
      question: 'proceed?',
      dedupeKey: 'bubble-1',
    });
    expect(repeat).toBeNull();
  });
});
