import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPool, truncateAll } from '../../test/helpers/testDb.js';
import { UsersRepository } from './usersRepository.js';

describe('UsersRepository', () => {
  beforeEach(async () => {
    await truncateAll(await getTestPool());
  });

  it('upserts a new user with defaults', async () => {
    const repo = new UsersRepository(await getTestPool());
    const user = await repo.upsert({ slackUserId: 'U123' });
    expect(user.slackUserId).toBe('U123');
    expect(user.timezone).toBe('UTC');
    expect(user.quietHoursStart).toBe(22);
    expect(user.quietHoursEnd).toBe(8);
    expect(user.dailyDmCap).toBe(10);
  });

  it('upsert is idempotent and updates fields on conflict', async () => {
    const repo = new UsersRepository(await getTestPool());
    await repo.upsert({ slackUserId: 'U123' });
    const updated = await repo.upsert({ slackUserId: 'U123', timezone: 'America/New_York' });
    expect(updated.timezone).toBe('America/New_York');
    const found = await repo.findById('U123');
    expect(found?.timezone).toBe('America/New_York');
  });

  it('findById returns null when not found', async () => {
    const repo = new UsersRepository(await getTestPool());
    expect(await repo.findById('missing')).toBeNull();
  });
});
