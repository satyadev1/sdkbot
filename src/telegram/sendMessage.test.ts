import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { escapeHtml, postTelegramMessage } from './sendMessage.js';

describe('escapeHtml', () => {
  it('escapes the three characters HTML parse mode is sensitive to', () => {
    expect(escapeHtml('<b>Ship it?</b> & go')).toBe('&lt;b&gt;Ship it?&lt;/b&gt; &amp; go');
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Ship it? (options: Yes, No)')).toBe('Ship it? (options: Yes, No)');
  });
});

describe('postTelegramMessage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }),
    ) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sets parse_mode HTML only when requested', async () => {
    await postTelegramMessage('token', 'chat1', '<b>hi</b>', { html: true });
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as string) ?? '{}');
    expect(body.parse_mode).toBe('HTML');
  });

  it('omits parse_mode for plain text', async () => {
    await postTelegramMessage('token', 'chat1', 'hi');
    const body = JSON.parse((vi.mocked(global.fetch).mock.calls[0]?.[1]?.body as string) ?? '{}');
    expect(body.parse_mode).toBeUndefined();
  });
});
