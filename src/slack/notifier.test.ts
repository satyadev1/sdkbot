import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSlackNotification } from './notifier.js';

describe('sendSlackNotification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the message text as JSON to the webhook URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await sendSlackNotification('https://hooks.slack.com/services/T000/B000/XXXX', 'hello');

    expect(fetchMock).toHaveBeenCalledWith('https://hooks.slack.com/services/T000/B000/XXXX', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
  });

  it('throws when the webhook responds with a non-2xx status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendSlackNotification('https://hooks.slack.com/services/T000/B000/XXXX', 'hello')).rejects.toThrow(
      /500/,
    );
  });
});
