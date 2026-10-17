import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PreparedContent } from '@tripflow/contracts';
import { Narrator, narrationChunks } from '../lib/narration';
import { ContentCard } from '../components/ContentViewer';

function setup() {
  const queued: SpeechSynthesisUtterance[] = [];
  const voice = { lang: 'zh-CN', localService: true } as SpeechSynthesisVoice;
  const engine = { cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), getVoices: () => [voice],
    speak: vi.fn((u: SpeechSynthesisUtterance) => { queued.push(u); }) };
  const player = new Narrator(engine as unknown as SpeechSynthesis, (text) => ({ text } as SpeechSynthesisUtterance));
  return { player, queued, engine, voice };
}
const start = (u: SpeechSynthesisUtterance) => u.onstart?.({} as SpeechSynthesisEvent);
const end = (u: SpeechSynthesisUtterance) => u.onend?.({} as SpeechSynthesisEvent);
afterEach(() => vi.useRealTimers());

describe('guide narration lifecycle', () => {
  it('speaks Chinese sentences sequentially and supports pause/resume', () => {
    const { player, queued, engine, voice } = setup();
    player.start('guide-one', '先看看长城的城墙。再看看敌楼。');
    expect(queued).toHaveLength(1); expect(queued[0].voice).toBe(voice);
    expect(player.getSnapshot().status).toBe('loading');
    start(queued[0]); expect(player.getSnapshot().status).toBe('playing');
    player.pause(); expect(engine.pause).toHaveBeenCalled(); expect(player.getSnapshot().status).toBe('paused');
    player.resume(); expect(player.getSnapshot().status).toBe('playing');
    end(queued[0]); expect(queued).toHaveLength(2);
    start(queued[1]); end(queued[1]); expect(player.getSnapshot().status).toBe('idle');
  });
  it('never restarts cancelled or replaced speech from late browser events', () => {
    const { player, queued } = setup();
    player.start('old', '第一句。第二句。');
    const old = queued[0]; player.stop(); end(old); start(old);
    expect(queued).toHaveLength(1); expect(player.getSnapshot().status).toBe('idle');
    player.start('new', '新的讲解。'); end(old);
    expect(queued).toHaveLength(2); expect(player.getSnapshot().contentId).toBe('new');
    player.stop();
  });
  it('reports unavailable or blocked speech honestly and keeps text usable', () => {
    vi.useFakeTimers();
    const unavailable = new Narrator(); unavailable.start('id', '讲解');
    expect(unavailable.getSnapshot().error).toContain('暂不支持语音');
    const { player } = setup(); player.start('id', '讲解');
    vi.advanceTimersByTime(8001);
    expect(player.getSnapshot().status).toBe('error'); expect(player.getSnapshot().error).toContain('播放重试');
  });
  it('removes citation URLs and bounds utterance length without splitting Unicode characters', () => {
    const chunks = narrationChunks('**长城**的故事。\n' + '山'.repeat(300) + '\n参考来源：\nhttps://example.org/x');
    expect(chunks.every((s) => Array.from(s).length <= 140)).toBe(true);
    expect(chunks.join('')).not.toMatch(/参考来源|https:|\*\*/);
  });
  it('renders guide text and playback controls without document labels or generation metadata', () => {
    const c: PreparedContent = { contentId: 'guide-one', tripId: 't', baseRevision: 1, placeId: 'p', module: 'KNOWLEDGE',
      title: '八达岭', body: '八达岭的城墙沿着山脊延伸。', version: 1, generatedAt: '2026-10-17T04:00:00Z',
      evidence: [], scopeNote: '来源说明', deliveryMode: 'GUIDE', generationProvider: 'internal-provider' };
    const html = renderToStaticMarkup(<ContentCard c={c} />);
    expect(html).toContain('AI 导游'); expect(html).toContain('播放讲解'); expect(html).toContain(c.body);
    expect(html).not.toMatch(/AI 创作辅助|internal-provider|辅助稿/);
  });
});
