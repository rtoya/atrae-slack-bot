/**
 * Time clock management using Cloudflare KV
 */

export interface TimeClockRecord {
  id: string;
  userId: string;
  type: 'clock_in' | 'clock_out' | 'break_begin' | 'break_end';
  datetime: string; // ISO 8601 format
  baseDate: string; // YYYY-MM-DD
}

/**
 * Save time clock record to KV
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
    id: `${userId}-${Date.now()}`,
    userId,
    type,
    datetime: now.toISOString(),
    baseDate
  };

  // Store the latest record for the user
  await kv.put(`latest:${userId}`, JSON.stringify(record));

  // Also store in a date-based key for history
  await kv.put(`${userId}:${baseDate}:${record.id}`, JSON.stringify(record));

  return record;
}

/**
 * Get latest time clock record from KV
 */
export async function getLatestTimeClock(
  kv: KVNamespace,
  userId: string
): Promise<TimeClockRecord | null> {
  const data = await kv.get(`latest:${userId}`);
  if (!data) {
    return null;
  }
  return JSON.parse(data);
}

/**
 * Get all time clock records for a user on a specific date
 */
export async function getTimeClocksByDate(
  kv: KVNamespace,
  userId: string,
  baseDate: string
): Promise<TimeClockRecord[]> {
  const list = await kv.list({ prefix: `${userId}:${baseDate}:` });
  const records: TimeClockRecord[] = [];

  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) {
      records.push(JSON.parse(data));
    }
  }

  // Sort by datetime descending
  records.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  return records;
}
