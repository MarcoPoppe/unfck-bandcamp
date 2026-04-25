import { bcGet } from './http';
import { parseReleasePage } from './parse_release';
import type { BcReleaseInfo } from './parse_release';

export async function fetchReleasePage(
  bcUrl: string,
  cookieString: string,
): Promise<BcReleaseInfo> {
  const res = await bcGet(bcUrl, { cookieString });
  if (res.status !== 200) {
    throw new Error(`release page ${bcUrl} returned ${res.status}`);
  }
  const html = await res.text();
  const release = parseReleasePage(html, bcUrl);
  if (!release) {
    throw new Error(`release page ${bcUrl} did not contain TralbumData`);
  }
  return release;
}
