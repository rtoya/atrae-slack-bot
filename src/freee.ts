/**
 * Freee HR API client for attendance management
 */

export interface FreeeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface FreeeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
}

export interface AttendanceRecord {
  id: number;
  date: string;
  clock_in_at: string;
  clock_out_at: string | null;
}

/**
 * Generate OAuth authorization URL
 */
export function getAuthorizationUrl(config: FreeeConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'write'
  });
  return `https://accounts.secure.freee.co.jp/public_api/authorize?${params}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeCodeForToken(
  code: string,
  config: FreeeConfig
): Promise<FreeeTokens> {
  const response = await fetch('https://accounts.secure.freee.co.jp/public_api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: code,
      redirect_uri: config.redirectUri
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange code: ${await response.text()}`);
  }

  const data = await response.json<any>();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  };
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: FreeeConfig
): Promise<FreeeTokens> {
  const response = await fetch('https://accounts.secure.freee.co.jp/public_api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${await response.text()}`);
  }

  const data = await response.json<any>();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000)
  };
}

/**
 * Get valid access token (refresh if expired)
 */
export async function getValidToken(
  tokens: FreeeTokens,
  config: FreeeConfig
): Promise<FreeeTokens> {
  // Refresh if token expires in less than 5 minutes
  if (tokens.expires_at < Date.now() + (5 * 60 * 1000)) {
    return await refreshAccessToken(tokens.refresh_token, config);
  }
  return tokens;
}

/**
 * Clock in (start work)
 */
export async function clockIn(
  accessToken: string,
  companyId: number
): Promise<AttendanceRecord> {
  // Get current date in JST (YYYY-MM-DD format)
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const baseDate = jstDate.toISOString().split('T')[0];

  const response = await fetch(
    `https://api.freee.co.jp/hr/api/v1/employees/me/time_clocks`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        company_id: companyId,
        type: 'clock_in',
        base_date: baseDate
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clock in: ${error}`);
  }

  const data = await response.json<any>();
  return data.time_clock;
}

/**
 * Clock out (finish work)
 */
export async function clockOut(
  accessToken: string,
  companyId: number
): Promise<AttendanceRecord> {
  // Get current date in JST (YYYY-MM-DD format)
  const now = new Date();
  const jstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const baseDate = jstDate.toISOString().split('T')[0];

  const response = await fetch(
    `https://api.freee.co.jp/hr/api/v1/employees/me/time_clocks`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        company_id: companyId,
        type: 'clock_out',
        base_date: baseDate
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to clock out: ${error}`);
  }

  const data = await response.json<any>();
  return data.time_clock;
}

/**
 * Get user's company ID
 */
export async function getCompanyId(accessToken: string): Promise<number> {
  const response = await fetch(
    'https://api.freee.co.jp/hr/api/v1/users/me',
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get user info: ${error}`);
  }

  const data = await response.json<any>();
  return data.companies[0].id; // Use first company
}
