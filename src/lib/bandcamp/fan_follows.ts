import { BC_ORIGIN, BC_USER_AGENT } from './http';

export interface BcFollowInput {
  entityType: 'artist' | 'label' | 'digger';
  entityBcId: number;
  action: 'follow' | 'unfollow';
  cookieString: string;
}

/**
 * Mirror a follow/unfollow action to Bandcamp using the same form-encoded
 * endpoints the bandcamp.com UI uses. Best-effort: if Bandcamp changes the
 * endpoint or rate-limits us, the caller catches the throw and surfaces a
 * non-fatal warning to the user.
 */
export async function bcSetFollow(input: BcFollowInput): Promise<void> {
  const url =
    input.entityType === 'digger'
      ? `${BC_ORIGIN}/fan_follow_fan_cb`
      : `${BC_ORIGIN}/fan_follow_band_cb`;
  const params = new URLSearchParams({
    [input.entityType === 'digger' ? 'fan_id' : 'band_id']: String(input.entityBcId),
    action: input.action,
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: input.cookieString,
      Origin: BC_ORIGIN,
      Referer: `${BC_ORIGIN}/`,
      'User-Agent': BC_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Bandcamp ${input.action} endpoint returned ${res.status}${
        text ? ` (${text.slice(0, 160)})` : ''
      }`,
    );
  }
}
