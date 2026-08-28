export async function postSlackMessage(
  botToken: string,
  channelId: string,
  text: string,
): Promise<string> {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const body = (await response.json()) as { ok: boolean; ts?: string; error?: string };
  if (!response.ok || !body.ok || !body.ts) {
    throw new Error(`Slack chat.postMessage failed: ${body.error ?? response.status}`);
  }
  return body.ts;
}
