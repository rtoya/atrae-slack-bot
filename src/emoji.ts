export type EmojiEntry = {
  name: string;
  url: string;
};

/**
 * Get emoji list with KV caching and alias resolution
 * @param teamId - Slack team ID
 * @param kv - KV namespace for caching
 * @param botToken - Bot access token
 * @param ttlSec - Cache TTL in seconds (default: 12 hours)
 * @returns Array of emoji entries
 */
export async function getEmojiList(
  teamId: string,
  kv: KVNamespace,
  botToken: string,
  ttlSec = 43200 // 12 hours
): Promise<EmojiEntry[]> {
  const key = `emoji:list:${teamId}`;
  const cached = await kv.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch emoji list from Slack API
  const res = await fetch('https://slack.com/api/emoji.list', {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${botToken}` }
  });

  const data = await res.json<any>();

  if (!data.ok) {
    throw new Error(`emoji.list failed: ${JSON.stringify(data)}`);
  }

  // data.emoji is { name: url | 'alias:xxx' }
  const map: Record<string, string> = data.emoji ?? {};
  const resolved: Record<string, string> = {};

  // First pass: copy all entries
  for (const [name, url] of Object.entries(map)) {
    resolved[name] = url;
  }

  // Second pass: resolve aliases (1 level)
  for (const [name, url] of Object.entries(resolved)) {
    if (url.startsWith('alias:')) {
      const base = url.replace('alias:', '');
      if (resolved[base] && !resolved[base].startsWith('alias:')) {
        resolved[name] = resolved[base];
      }
    }
  }

  // Convert to array and filter out unresolved aliases
  const list = Object.entries(resolved)
    .filter(([_, url]) => !url.startsWith('alias:'))
    .map(([name, url]) => ({ name, url }));

  // Cache the result
  await kv.put(key, JSON.stringify(list), { expirationTtl: ttlSec });

  return list;
}

/**
 * Filter emoji options for external_select
 * @param list - Full emoji list
 * @param query - Search query
 * @param limit - Maximum number of results
 * @returns Array of option objects for Slack Block Kit
 */
export function filterEmojiOptions(
  list: EmojiEntry[],
  query = '',
  limit = 100
) {
  const q = query.trim().toLowerCase();
  const hit = q
    ? list.filter(e => e.name.toLowerCase().includes(q))
    : list;

  const top = hit.slice(0, limit);

  return top.map(e => ({
    text: { type: 'plain_text', text: `:${e.name}:` },
    value: e.name
  }));
}
