import { nativeSpeech, makeUtterance as createUtterance } from './nativeSpeech';

export type NarrationState = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'; contentId?: string; error?: string;
};
export const SILENT: NarrationState = { status: 'idle' };

/** Short sentence chunks avoid long-utterance cutoffs; sources and URLs are never read aloud. */
export function narrationChunks(body: string): string[] {
  const text = body.split(/\n\s*参考来源[：:]/)[0].replace(/https?:\/\/\S+/g, '')
    .replace(/[*#`]/g, '').trim();
  return (text.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? []).flatMap((sentence) => {
    const chars = Array.from(sentence.trim());
    const chunks = [];
    while (chars.length) chunks.push(chars.splice(0, 140).join(''));
    return chunks;
  }).filter(Boolean);
}

/** One active guide across the app. Late speech events cannot restart a cancelled guide. */
export class Narrator {
  private state: NarrationState = SILENT;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private utterance?: SpeechSynthesisUtterance;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private engine?: SpeechSynthesis, private makeUtterance = createUtterance) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: NarrationState) { this.state = state; this.listeners.forEach((f) => f()); }
  stop = () => {
    this.epoch++;
    clearTimeout(this.timer);
    this.utterance = undefined;
    this.engine?.cancel();
    this.update(SILENT);
  };
  start = (contentId: string, body: string) => {
    this.stop();
    if (!this.engine) { this.update({ status: 'error', contentId, error: '当前浏览器暂不支持语音，请使用支持语音的浏览器，或先查看文字讲解。' }); return; }
    const chunks = narrationChunks(body);
    if (!chunks.length) return;
    const epoch = this.epoch;
    let index = 0;
    const fail = () => {
      if (epoch !== this.epoch) return;
      this.stop();
      this.update({ status: 'error', contentId, error: '语音暂未播放成功，请点击播放重试，或检查浏览器与设备声音设置。' });
    };
    const next = () => {
      if (epoch !== this.epoch) return;
      if (index >= chunks.length) { this.utterance = undefined; this.update(SILENT); return; }
      const utterance = this.makeUtterance(chunks[index++]);
      this.utterance = utterance;
      utterance.lang = 'zh-CN'; utterance.rate = 1;
      const voices = this.engine!.getVoices();
      const chinese = voices.filter((v) => /^zh([_-]|$)/i.test(v.lang));
      const voice = chinese.find((v) => /^zh[-_]CN$/i.test(v.lang) && v.localService)
        ?? chinese.find((v) => /^zh[-_]CN$/i.test(v.lang)) ?? chinese[0];
      if (voice) utterance.voice = voice;
      utterance.onstart = () => {
        if (epoch !== this.epoch || this.utterance !== utterance) return;
        clearTimeout(this.timer);
        this.update({ status: 'playing', contentId });
      };
      utterance.onend = () => { if (epoch === this.epoch && this.utterance === utterance) { clearTimeout(this.timer); next(); } };
      utterance.onerror = fail;
      this.update({ status: 'loading', contentId });
      this.timer = setTimeout(fail, 8000);
      try { this.engine!.speak(utterance); } catch { fail(); }
    };
    // cancel() clears queued speech but some browsers retain their paused state.
    this.engine.resume();
    next();
  };
  pause = () => {
    if (this.state.status !== 'playing') return;
    this.engine?.pause(); this.update({ ...this.state, status: 'paused' });
  };
  resume = () => {
    if (this.state.status !== 'paused') return;
    this.engine?.resume(); this.update({ ...this.state, status: 'playing' });
  };
}

let instance: Narrator | undefined;
export function narrator(): Narrator {
  if (!instance) {
    instance = new Narrator(typeof window !== 'undefined' ? nativeSpeech(window) ?? window.speechSynthesis : undefined);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.hidden) instance?.stop(); });
      window.addEventListener('pagehide', () => instance?.stop());
    }
  }
  return instance;
}
