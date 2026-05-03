/**
 * Render a timestamp as `dd.mm.yyyy HH:MM` (Marco's preferred format).
 * Accepts:
 *   - SQLite `datetime('now')` strings ("YYYY-MM-DD HH:MM:SS", treated as UTC)
 *   - ISO 8601 strings (with or without timezone)
 *   - Bandcamp's RFC-1123-ish strings ("01 Mar 2024 17:23:11 GMT")
 *
 * Returns the input unchanged when it doesn't parse, so a malformed
 * value never breaks rendering. Time component is in the user's local
 * timezone — keeps the display intuitive ("when did this happen for me")
 * even though SQLite stores UTC.
 */
const SQLITE_TS_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/;

export function formatDateTime(input: string | null | undefined): string {
  if (!input) return '';
  // Fast path for SQLite's "YYYY-MM-DD HH:MM:SS[.fff]" — the JS Date
  // constructor reads it as local time (which is wrong for UTC) on most
  // engines. Append Z so it parses as UTC and the resulting display
  // lands in the user's zone.
  const sqliteMatch = input.match(SQLITE_TS_RE);
  const isoCandidate = sqliteMatch ? `${sqliteMatch[1]}T${sqliteMatch[2]}Z` : input;
  const ts = Date.parse(isoCandidate);
  if (!Number.isFinite(ts)) return input;
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

/**
 * Date-only variant of formatDateTime: `dd.mm.yyyy`. For places where
 * the time would be noise (release dates, "purchased on" labels, etc.).
 */
export function formatDate(input: string | null | undefined): string {
  if (!input) return '';
  const sqliteMatch = input.match(SQLITE_TS_RE);
  const isoCandidate = sqliteMatch ? `${sqliteMatch[1]}T${sqliteMatch[2]}Z` : input;
  const ts = Date.parse(isoCandidate);
  if (!Number.isFinite(ts)) return input;
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}
