import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { SlackAnswersRepository } from './slackAnswersRepository.js';

describe('SlackAnswersRepository', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
  });

  it('creates a pending answer row', async () => {
    const repo = new SlackAnswersRepository(await getTestPool());
    const row = await repo.create({ sessionId: 'abc12345', question: 'proceed?' });
    expect(row.status).toBe('pending');
    expect(row.threadTs).toBeNull();
  });

  it('recordAnswer matches by threadTs and flips status to answered', async () => {
    const repo = new SlackAnswersRepository(await getTestPool());
    const row = await repo.create({ sessionId: 'abc12345', question: 'proceed?' });
    await repo.setThreadTs(row.id, '1699999999.000100');

    const answered = await repo.recordAnswer('1699999999.000100', 'yes go ahead');
    expect(answered?.status).toBe('answered');
    expect(answered?.answer).toBe('yes go ahead');
  });

  it('recordAnswer returns null when no pending row matches the threadTs', async () => {
    const repo = new SlackAnswersRepository(await getTestPool());
    const result = await repo.recordAnswer('unknown-ts', 'yes');
    expect(result).toBeNull();
  });

  it('findLatestForSession returns the most recently created row for that session', async () => {
    const repo = new SlackAnswersRepository(await getTestPool());
    await repo.create({ sessionId: 'abc12345', question: 'first?' });
    const second = await repo.create({ sessionId: 'abc12345', question: 'second?' });

    const latest = await repo.findLatestForSession('abc12345');
    expect(latest?.id).toBe(second.id);
  });
});
