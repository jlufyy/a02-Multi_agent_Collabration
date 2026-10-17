import { describe, expect, it, vi } from 'vitest';
import { nativeSpeech, makeUtterance } from '../lib/nativeSpeech';
import { Narrator } from '../lib/narration';
import { normalizeDiningRequirements, requirementProblems } from '../lib/requirements';
import { trip } from './fixtures';

describe('Android adaptations', () => {
  it('does not require a restaurant choice for an unbound dining preference', () => {
    const req = trip().requirements;
    const food = { id: 'food', type: 'FOOD' as const, userRequest: '中午吃杭州特色美食', desiredOutputs: [], confirmed: false,
      status: 'PENDING' as const, preparedContentIds: [], locked: false };
    const normalized = normalizeDiningRequirements({ ...req, intents: [food] });
    expect(normalized.intents).toEqual([]);
    expect(normalized.preferences).toContain(food.userRequest);
    expect(Object.keys(requirementProblems(normalized)).some((key) => key.startsWith('intents.'))).toBe(false);
    expect(normalizeDiningRequirements({ ...req, intents: [{ ...food, placeQuery: '合成餐馆' }] }).intents).toHaveLength(1);
  });

  it('uses native speech callbacks, resumes a sentence and ignores cancelled events', () => {
    const win = new EventTarget();
    const speak = vi.fn();
    const stop = vi.fn();
    Object.assign(win, { TripFlowSpeech: { speak, stop } });
    const player = new Narrator(nativeSpeech(win as unknown as Window), makeUtterance);
    const event = (id: string, type: string) => win.dispatchEvent(new CustomEvent('tripflow-speech', { detail: { id, type } }));
    player.start('test', '这是一段合成语音测试。');
    const id = speak.mock.calls[0][1];
    event(id, 'start');
    expect(player.getSnapshot().status).toBe('playing');
    player.pause();
    expect(player.getSnapshot().status).toBe('paused');
    player.resume();
    const resumed = speak.mock.calls[1][1];
    expect(resumed).not.toBe(id);
    event(id, 'end');
    expect(player.getSnapshot().status).toBe('playing');
    player.stop();
    event(resumed, 'start');
    expect(player.getSnapshot().status).toBe('idle');
    expect(stop).toHaveBeenCalled();
  });
});
