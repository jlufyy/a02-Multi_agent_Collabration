/** Android WebView has no Web Speech API. Adapt the app's bounded native TTS bridge. */
export function nativeSpeech(win: Window): SpeechSynthesis | undefined {
  const bridge = (win as Window & { TripFlowSpeech?: { speak(text: string, id: string): void; stop(): void } }).TripFlowSpeech;
  if (!bridge) return undefined;
  let current: SpeechSynthesisUtterance | undefined;
  let activeId = '';
  let epoch = 0;
  let paused = false;
  const play = () => {
    if (!current) return;
    activeId = `native-${++epoch}`;
    bridge.speak(current.text, activeId);
  };
  win.addEventListener('tripflow-speech', ((event: CustomEvent<{ id: string; type: string }>) => {
    if (event.detail.id !== activeId || !current || paused) return;
    const utterance = current;
    const callback = event.detail.type === 'start' ? utterance.onstart : event.detail.type === 'end' ? utterance.onend : utterance.onerror;
    if (event.detail.type !== 'start') current = undefined;
    callback?.call(utterance, {} as never);
  }) as EventListener);
  return {
    getVoices: () => [],
    speak: (utterance: SpeechSynthesisUtterance) => { current = utterance; paused = false; play(); },
    cancel: () => { current = undefined; activeId = ''; paused = false; bridge.stop(); },
    // Android TTS resumes the current short sentence; completed sentences aren't repeated.
    pause: () => { paused = true; activeId = ''; bridge.stop(); },
    resume: () => { if (paused) { paused = false; play(); } },
  } as unknown as SpeechSynthesis;
}

export function makeUtterance(text: string): SpeechSynthesisUtterance {
  return typeof SpeechSynthesisUtterance === 'function' ? new SpeechSynthesisUtterance(text)
    : { text, lang: '', rate: 1, onstart: null, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance;
}
