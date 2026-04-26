import { create } from 'zustand';
import type { TrackRowData } from '@/components/TrackRow';

export interface PlayerState {
  queue: TrackRowData[];
  currentId: number | null;
  isPlaying: boolean;
  setQueue: (queue: TrackRowData[]) => void;
  toggle: (id: number) => void;
  setIsPlaying: (playing: boolean) => void;
  next: () => void;
  prev: () => void;
  stop: () => void;
}

function findNextStreamable(
  queue: TrackRowData[],
  fromIndex: number,
  direction: 1 | -1,
): TrackRowData | null {
  let i = fromIndex + direction;
  while (i >= 0 && i < queue.length) {
    if (queue[i].hasStream) return queue[i];
    i += direction;
  }
  return null;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  currentId: null,
  isPlaying: false,
  setQueue: (queue) => set({ queue }),
  toggle: (id) => {
    const { queue, currentId, isPlaying } = get();
    const target = queue.find((t) => t.id === id);
    if (!target || !target.hasStream) return;
    if (currentId === id) {
      // Same track: pause/resume toggle, keep currentId so the player keeps the position.
      set({ isPlaying: !isPlaying });
    } else {
      set({ currentId: id, isPlaying: true });
    }
  },
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  next: () => {
    const { queue, currentId } = get();
    if (currentId == null || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    const target = findNextStreamable(queue, idx, 1);
    if (target) set({ currentId: target.id, isPlaying: true });
    else set({ currentId: null, isPlaying: false });
  },
  prev: () => {
    const { queue, currentId } = get();
    if (currentId == null || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === currentId);
    if (idx < 0) return;
    const target = findNextStreamable(queue, idx, -1);
    if (target) set({ currentId: target.id, isPlaying: true });
  },
  stop: () => set({ currentId: null, isPlaying: false }),
}));
