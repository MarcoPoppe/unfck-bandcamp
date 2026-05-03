# TrackRow Unification

**Date:** 2026-05-04
**Target version:** 1.45.0

## Goal

Every track-list in the app renders through a single `<TrackRow>` so the
visual language stays consistent. Variations (reorder arrows, position
numbers, album-expand, remove buttons) are opt-in props the consumer sets;
elements simply hide when their prop is absent.

Marco's reference pattern: the curator-collection page (`/digger/[id]`)
when an album row is expanded shows the album header at full size and the
contained tracks below as a tighter sub-list — the same visual hierarchy
should appear everywhere we have grouping (playlists, search results
later, etc).

## Current state — three different implementations

1. **`src/components/TrackRow.tsx`** — used by Library, History,
   Discover/New tracks, Wishlist (via TrackRowData mapping). Renders cover
   + title block + optional album column + duration + action bar. No
   reorder, no position, no album-expand.
2. **`src/app/digger/[id]/DiggerDetailClient.tsx::renderCollectionItem`**
   (200+ LOC) — bespoke layout for curator-collection items. Has the
   "Tracks ▾" album-expand button, inline tracklist on expand, "You own
   this" pill, owner-redirect link target (`/track/go?url=…`).
3. **`src/app/digger/[id]/DiggerDetailClient.tsx::DiggerAlbumTrackRow`** —
   compact variant rendered inside an expanded album. Position number
   instead of cover, no album column.
4. **`src/app/playlists/[id]/...`** — playlist detail; current shape
   includes reorder ↑/↓ arrows and a Remove button.
5. **Discover Tracks-Tab** — wraps TrackRow inside an outer flex with a
   checkbox left of the row (multi-select pattern).

Same icons, same actions, three different layouts. Painful to evolve.

## Target API

`TrackRow` becomes the single rendering primitive. Layout slots:

```
[leading?]  [cover]  [title-block]  [album-column?]  [duration?]  [actions]  [trailing?]
[expanded-region (full row width, below)]
```

```ts
interface TrackRowProps {
  // Required
  track: TrackRowData;          // existing shape, unchanged

  // Variant
  variant?: 'full' | 'compact'; // 'full' = cover (default); 'compact' =
                                 //   position number, no cover, used for
                                 //   sub-rows inside expanded albums.

  // Leading slot — anything left of the cover/position. Only one wins:
  position?: number | null;     // shows "1", "2", … (playlists, album-tracks)
  reorderControls?: {           // shows ↑/↓ arrows
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
  };
  selectable?: {                // shows a checkbox
    selected: boolean;
    onToggle: () => void;
    label?: string;             // aria-label
  };

  // Trailing slot — anything right of the action bar.
  trailing?: ReactNode;         // album-expand button, remove button, etc.

  // Below-row region. Rendered full-width under the row, indented under
  // the title column. Used for curator-collection album-expand tracklists.
  expandedContent?: ReactNode;

  // Action-bar configuration (existing TrackActionsBar wraps these):
  showWishlist?: boolean;       // default true
  showPlaylist?: boolean;       // default true
  showFollow?: boolean;         // default false (only Library + Curator
                                //   show artist+label follow buttons)
  showArchive?: boolean;        // default false
  showBcLink?: boolean;         // default true

  // Display tweaks:
  hideAlbumColumn?: boolean;    // discover-tracks + curator-collection
                                //   already drop the album column to make
                                //   the title-block the dominant element
  hideDuration?: boolean;       // playlists currently show no duration
                                //   column either; curator-collection
                                //   shows it inline in the title block

  // Override the default title link (`/track/[bcTrackId]`) — curator-
  // collection items want `/track/go?url=...` so the resolver can run on
  // hover-tab-open without freezing the click. When unset, default applies.
  titleHref?: string;

  // Pill rendered next to title (compact spec). Today only "You own this"
  // appears; keep it generic so future badges (e.g. "Promo") can reuse.
  badges?: Array<{ label: string; tone: 'accent' | 'success' | 'muted' }>;

  // Existing onPlayOverride (album-tracks need the parent to rebuild
  // queue from the inline tracklist).
  onPlayOverride?: () => void;

  // Existing visual states the row already handles internally:
  //   isCurrent, isPlaying, hasBeenPlayed, ...
}
```

## Layout engine

The current TrackRow uses a `grid-cols-[44px_56px_minmax(0,1fr)_minmax(0,180px)_60px_auto]`
layout. The new version uses a CSS grid with conditional template columns:

```ts
const cols = [
  hasLeading ? '40px' : null,        // checkbox / position / reorder cluster
  variant === 'compact' ? null : '48px sm:56px',   // cover
  'minmax(0,1fr)',                   // title block
  hideAlbumColumn ? null : 'minmax(0,180px)',
  hideDuration ? null : '60px',
  'auto',                            // actions
  trailing ? 'auto' : null,          // trailing button
].filter(Boolean).join(' ');
```

This keeps the same visual hierarchy across modes; columns simply collapse
when their prop is off.

## Migration plan — 5 phases

### Phase 1 — extend TrackRow API (30 min)
1. Add the new props above to `TrackRow.tsx`.
2. Implement leading/trailing slots, expandedContent below-row region,
   the action-bar gating, the badges pill.
3. Existing call sites compile unchanged — every new prop has a sensible
   default.
4. Verify Library, History, Discover-New-Tracks, Wishlist still render
   identically.

### Phase 2 — Curator-Collection track items (45 min)
File: `src/app/digger/[id]/DiggerDetailClient.tsx`
1. For items where `bcItemType === 't'`, replace the bespoke render with
   `<TrackRow track={...} showFollow showArchive titleHref={/track/go?...}
   badges={ownedByYou ? [{label:'You own this', tone:'accent'}] : []} />`.
2. Map `CollectionItem` → `TrackRowData`: when `localTrackId` is null,
   pass a synthetic negative id + `needsResolve: true` so the player
   resolves on first click (already supported pattern).
3. Drop the inline play button + cover + title + artist + label render —
   TrackRow handles all of that.

### Phase 3 — Curator-Collection album items (60 min)
1. For `bcItemType === 'a'`, use TrackRow with:
   - `trailing={<AlbumExpandToggle isExpanded onToggle />}`
   - `expandedContent={isExpanded ? <AlbumTracklist tracks={cached} /> : null}`
2. The expanded tracklist renders TrackRow recursively in `compact` mode
   (`variant: 'compact'`, `position: t.trackNumber`, no cover).
3. Delete `DiggerAlbumTrackRow` — its job is now `<TrackRow variant="compact">`.

### Phase 4 — Playlist detail (30 min)
File: `src/app/playlists/[id]/...`
1. Replace the custom row with `<TrackRow track position={pos+1}
   reorderControls={{onMoveUp,onMoveDown,canMoveUp,canMoveDown}}
   trailing={<RemoveButton />} hideDuration showFollow showArchive />`.
2. Drag-handle arrows live in the leading slot via `reorderControls`.
3. Remove button is the `trailing` slot.

### Phase 5 — Discover Tracks-Tab (15 min)
File: `src/app/discover/DiscoverHub.tsx::TracksTab`
1. Replace the outer `<div>` with a checkbox on the left + inline TrackRow
   with the new `selectable={{selected, onToggle}}` prop. The current
   wrapper-flex hack goes away — selection lives inside TrackRow's
   leading slot.
2. Same for Curator multi-select after Phase 2 lands.

## Edge cases

- **Lazy-resolve clicks** (curator items not in local `tracks`): TrackRow
  already supports `needsResolve` + synthetic negative ids. Title-link
  for these uses `titleHref="/track/go?url=..."` so middle-click opens
  correctly even when the resolve hasn't happened yet.
- **Track-only items in expanded album** are rendered with the SAME
  TrackRow primitive at variant `compact`. Their action bar is the same
  as the parent's, so the user can wishlist / playlist / follow without
  losing context.
- **Position numbers in playlists**: 1-indexed; `reorderControls.canMoveUp/Down`
  comes from index === 0 / index === length-1.
- **PlayedCheck and PartialPlayedDot**: TrackRow already renders these
  inside the title block when `track.hasBeenPlayed` or via the live
  `playedBcTrackIds` set. No prop change needed.

## What this does NOT change

- `TrackActionsBar` stays as-is. TrackRow keeps using it.
- The `TrackRowData` type stays mostly intact; only optional fields are
  added (e.g. `bcItemType` for curator-collection albums).
- `lib/sync/digger_collection.ts` already returns `localTrackId`,
  `bcTrackId`, `releasedAt` — Phase 2 just consumes them.

## Risks

1. **Recursive render in expanded albums** could thrash if not memoised.
   Mitigation: the inline tracklist passes a stable `albumTracksByBcUrl`
   reference (already in DiggerDetailClient state). Each child TrackRow
   takes its own `track` prop — no shared closure capture.
2. **Lazy-resolve race** when the user clicks Heart on a not-yet-imported
   curator-item: TrackActionsBar's lazy-resolve flow handles this, but
   the synthetic-id branch must propagate through TrackRow correctly.
   Validation: smoke test on a curator profile with zero owned items.
3. **Empty grid columns** must collapse cleanly. Test with all combinations
   of leading slots empty, album-column hidden, duration hidden.

## Testing checklist

After each phase, click through these pages and visually confirm rows look
identical to the current state of the **other** pages (i.e. unification):

- Library (`/tracks`) — full layout
- History (`/history`) — full layout
- Wishlist (`/wishlist`) — full layout, plus Bought tab
- Discover → New tracks — full layout + checkboxes
- Discover → Curators (in tab list) — multi-select
- Curator detail (`/digger/[id]`) — collection list, expand an album,
  verify sub-tracks look like the same row family in compact mode
- Track permalink (`/track/[id]`) — siblings list (already TrackRow,
  shouldn't change)
- Playlist detail — reorder + remove + actions

## Effort

- Phase 1: 30 min
- Phase 2: 45 min
- Phase 3: 60 min
- Phase 4: 30 min
- Phase 5: 15 min
- Smoke test + visual diff: 30 min

Total: **~3.5 hours** in one focused pass.

## Out of scope (future)

- Drag-and-drop reorder for playlists (currently arrow buttons only).
- Bulk-checkbox-select on the curator-detail page (today: select-all in
  Discover/Curators tab only). Could land via `selectable` once unified.
- A "card" layout variant for grid pages — TrackRow is list-only for now.
