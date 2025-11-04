/**
 * Time clock management using Cloudflare KV
 * Stores one record per user containing the latest clock action
 */

export interface TimeClockRecord {
  userId: string;
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end';
  datetime: string; // ISO 8601 format
  baseDate: string; // YYYY-MM-DD
}

/**
 * Save time clock record to KV
 * Stores only one record per user (overwrites previous record)
 */
export async function saveTimeClock(
  kv: KVNamespace,
  userId: string,
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end'
): Promise<TimeClockRecord> {
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const baseDate = jstDate.toISOString().split('T')[0];

  const record: TimeClockRecord = {
    userId,
    type,
    datetime: now.toISOString(),
    baseDate
  };

  // Store single record per user
  await kv.put(userId, JSON.stringify(record));

  return record;
}

/**
 * Get latest time clock record from KV
 */
export async function getLatestTimeClock(
  kv: KVNamespace,
  userId: string
): Promise<TimeClockRecord | null> {
  const data = await kv.get(userId);
  if (!data) {
    return null;
  }
  return JSON.parse(data);
}
