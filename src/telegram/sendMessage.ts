/** Escapes text so it renders literally inside a `parse_mode: 'HTML'` message. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type SendOptions = {
  /** Reply to this message id, so the user's own reply threads back to it. */
  replyToMessageId?: number;
  /** Set when `text` uses Telegram's HTML formatting tags (<b>, <code>, etc.). */
  html?: boolean;
};

export async function postTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: SendOptions = {},
): Promise<number> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(options.html ? { parse_mode: 'HTML' } : {}),
      ...(options.replyToMessageId ? { reply_to_message_id: options.replyToMessageId } : {}),
    }),
  });
  const body = (await response.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!response.ok || !body.ok || !body.result) {
    throw new Error(`Telegram sendMessage failed: ${body.description ?? response.status}`);
  }
  return body.result.message_id;
}
