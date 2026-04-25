// Plausible desktop UA so Bandcamp's frontend treats us like a normal browser.
// Mobile UAs trigger different markup paths and sometimes additional CAPTCHAs.
export const BC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const BC_ORIGIN = 'https://bandcamp.com';

export interface BcRequestOptions {
  cookieString: string;
  signal?: AbortSignal;
}

export async function bcGet(url: string, opts: BcRequestOptions): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      Cookie: opts.cookieString,
      'User-Agent': BC_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal: opts.signal,
  });
}

export async function bcPostJson<T>(
  url: string,
  body: unknown,
  opts: BcRequestOptions,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Cookie: opts.cookieString,
      'User-Agent': BC_USER_AGENT,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: BC_ORIGIN,
      Referer: `${BC_ORIGIN}/`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`bandcamp ${url} returned ${res.status}`);
  }
  return (await res.json()) as T;
}
