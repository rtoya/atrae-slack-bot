/**
 * Generic Slack API call wrapper
 * @param path - API path (e.g., 'views.open', 'chat.postMessage')
 * @param token - Slack access token (bot or user)
 * @param body - Request body
 * @returns API response
 */
export async function slackApi(
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<any> {
  const res = await fetch(`https://slack.com/api/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });

  const json = await res.json<any>();

  if (!json.ok) {
    throw new Error(`${path} failed: ${JSON.stringify(json)}`);
  }

  return json;
}
