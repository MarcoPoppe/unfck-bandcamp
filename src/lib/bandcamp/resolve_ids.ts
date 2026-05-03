import { bcGet, BC_ORIGIN } from './http';

/**
 * Resolve a numeric Bandcamp band id to its canonical artist URL via the
 * mobile band_details endpoint. Returns null if the id can't be resolved
 * (BC 404, network error, or the endpoint stops returning bandcamp_url).
 *
 * Used by /artist/[bcBandId] when the band id is not in our local DB yet,
 * to back-fill the artist row before rendering the page (instead of 404).
 */
export async function resolveBandIdToUrl(
  bcBandId: number,
  cookieString: string,
): Promise<{ bcUrl: string; name: string | null; imageUrl: string | null } | null> {
  const url = `${BC_ORIGIN}/api/mobile/24/band_details?band_id=${bcBandId}`;
  try {
    const res = await bcGet(url, { cookieString });
    if (res.status !== 200) return null;
    const json = (await res.json()) as {
      bandcamp_url?: string;
      url?: string;
      name?: string;
      bio_image_url?: string;
      image_id?: number;
    };
    const bcUrl = json.bandcamp_url ?? json.url ?? null;
    if (!bcUrl) return null;
    return {
      bcUrl,
      name: json.name ?? null,
      imageUrl:
        json.bio_image_url ??
        (json.image_id ? `https://f4.bcbits.com/img/${json.image_id}_10.jpg` : null),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a numeric Bandcamp fan id to its username via the mobile
 * fan_id_for_url-style endpoint. Returns null if the lookup fails.
 *
 * Used by /digger/[bcFanId] when the fan id is not in our local DB yet,
 * to back-fill the curator row before rendering the page (instead of 404).
 */
export async function resolveFanIdToUsername(
  bcFanId: number,
  cookieString: string,
): Promise<{ username: string; displayName: string | null; imageUrl: string | null } | null> {
  // /api/fan/2/info accepts fan_id and returns a small profile slice.
  const url = `${BC_ORIGIN}/api/fan/2/info?fan_id=${bcFanId}`;
  try {
    const res = await bcGet(url, { cookieString });
    if (res.status === 200) {
      const json = (await res.json()) as {
        username?: string;
        name?: string;
        image_id?: number;
      };
      if (json.username) {
        return {
          username: json.username,
          displayName: json.name ?? null,
          imageUrl: json.image_id
            ? `https://f4.bcbits.com/img/${json.image_id}_50.jpg`
            : null,
        };
      }
    }
  } catch {
    // fall through to the fan_id_for_url fallback below
  }
  // Fallback: collection_summary returns username when called with fan_id.
  try {
    const sumUrl = `${BC_ORIGIN}/api/fan/2/collection_summary?fan_id=${bcFanId}`;
    const res = await bcGet(sumUrl, { cookieString });
    if (res.status !== 200) return null;
    const json = (await res.json()) as {
      fan_data?: { username?: string; name?: string; image_id?: number };
    };
    const fan = json.fan_data;
    if (!fan?.username) return null;
    return {
      username: fan.username,
      displayName: fan.name ?? null,
      imageUrl: fan.image_id ? `https://f4.bcbits.com/img/${fan.image_id}_50.jpg` : null,
    };
  } catch {
    return null;
  }
}
