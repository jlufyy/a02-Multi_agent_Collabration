import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 三档底部抽屉（非模态）。
 * 说明：原计划使用 vaul，但 vaul 1.x 未把 modal={false} 传给底层 Radix Dialog，
 * 会给整个 #root 加 aria-hidden 并捕获焦点，导致地图与其他面板对辅助技术不可见。
 * 因此这里用一个只处理“顶部手柄拖动 → 吸附档位”的最小实现，不做通用手势引擎。
 */
export function BottomSheet({ snaps, snap, onSnap, label, children }: {
  snaps: readonly number[]; snap: number; onSnap: (s: number) => void; label: string; children: ReactNode;
}) {
  const [vh, setVh] = useState(() => window.innerHeight);
  const [drag, setDrag] = useState<number | null>(null); // 当前拖动中的可见高度(px)
  const start = useRef<{ y: number; h: number; t: number } | null>(null);

  useEffect(() => {
    const r = () => setVh(window.visualViewport?.height ?? window.innerHeight);
    r(); window.addEventListener('resize', r); window.visualViewport?.addEventListener('resize', r);
    return () => { window.removeEventListener('resize', r); window.visualViewport?.removeEventListener('resize', r); };
  }, []);

  const visible = drag ?? snap * vh;
  const maxH = Math.max(...snaps) * vh;

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: snap * vh, t: performance.now() };
    setDrag(snap * vh);
  }
  function onMove(e: React.PointerEvent) {
    if (!start.current) return;
    const h = start.current.h + (start.current.y - e.clientY);
    setDrag(Math.min(maxH + 24, Math.max(Math.min(...snaps) * vh - 24, h)));
  }
  function onUp(e: React.PointerEvent) {
    if (!start.current) return;
    const dy = start.current.y - e.clientY;
    const v = dy / Math.max(1, performance.now() - start.current.t); // px/ms，正值向上
    const h = start.current.h + dy;
    start.current = null; setDrag(null);
    if (Math.abs(dy) < 6) { // 轻点手柄：在档位间循环
      const i = snaps.indexOf(snap); onSnap(snaps[(i + 1) % snaps.length]); return;
    }
    let target = snaps.reduce((best, s) => (Math.abs(s * vh - h) < Math.abs(best * vh - h) ? s : best), snaps[0]);
    if (Math.abs(v) > 0.6) { // 快速甩动：向速度方向前进一档
      const i = snaps.indexOf(snap);
      target = snaps[Math.min(snaps.length - 1, Math.max(0, i + (v > 0 ? 1 : -1)))];
    }
    onSnap(target);
  }
  function onKey(e: React.KeyboardEvent) {
    const i = snaps.indexOf(snap);
    if (e.key === 'ArrowUp') { e.preventDefault(); onSnap(snaps[Math.min(snaps.length - 1, i + 1)]); }
    if (e.key === 'ArrowDown') { e.preventDefault(); onSnap(snaps[Math.max(0, i - 1)]); }
  }

  return (
    <section aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[560px] flex-col rounded-t-[24px] bg-white shadow-[0_-6px_30px_-10px_rgba(24,33,47,.25)]"
      style={{ height: maxH, transform: `translateY(${maxH - visible}px)`, transition: drag === null ? 'transform 280ms cubic-bezier(.22,1.15,.36,1)' : 'none' }}>
      <button type="button" aria-label={`调整面板高度（当前${snap >= 0.8 ? '全展开' : snap <= 0.25 ? '收起' : '半展开'}，上下方向键切换）`}
        className="-mb-1 flex h-8 shrink-0 touch-none cursor-grab items-center justify-center active:cursor-grabbing"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
        <span className="h-[5px] w-9 rounded-full bg-ink/20" />
      </button>
      {children}
    </section>
  );
}
