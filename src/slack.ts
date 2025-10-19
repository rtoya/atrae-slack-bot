/**
 * Verifies Slack request signature
 * @param req - The incoming request
 * @param signingSecret - Slack signing secret
 * @returns true if signature is valid
 */
export async function verifySlackRequest(req: Request, signingSecret: string): Promise<boolean> {
  const ts = req.headers.get('X-Slack-Request-Timestamp') ?? '';
  const sig = req.headers.get('X-Slack-Signature') ?? '';
  const body = await req.clone().text();

  // Replay attack prevention (5 minutes)
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) {
    return false;
  }

  const base = `v0:${ts}:${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  const expected = `v0=${hex}`;

  return timingSafeEqual(expected, sig);
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ua = enc.encode(a);
  const ub = enc.encode(b);

  if (ua.length !== ub.length) {
    return false;
  }

  let out = 0;
  for (let i = 0; i < ua.length; i++) {
    out |= ua[i] ^ ub[i];
  }

  return out === 0;
}
