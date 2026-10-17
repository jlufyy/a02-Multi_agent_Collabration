import { useSyncExternalStore } from 'react';
import { narrator, SILENT } from './narration';

export function useNarration() {
  const player = narrator();
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, () => SILENT);
  return { ...state, start: player.start, pause: player.pause, resume: player.resume, stop: player.stop };
}
