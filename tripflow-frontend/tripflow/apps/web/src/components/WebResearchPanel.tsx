import { useEffect, useRef, useState } from 'react';
import type { WebResearch } from '@tripflow/contracts';
import { api } from '../api/client';
import { ErrorBox, fmtDateTime } from './ui';
import { safeSourceUrl } from '../lib/validationMessages';

export function WebResearchPanel({ initial, poiId, city, visitDate }: {
  initial?: WebResearch; poiId?: string; city?: string; visitDate?: string;
}) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const controller = useRef<AbortController>();
  useEffect(() => { setResult(initial); setError(undefined); setBusy(false); return () => controller.current?.abort(); }, [initial, poiId]);
  async function search() {
    if (!poiId || !city || !visitDate) return;
    controller.current?.abort();
    const c = new AbortController(); controller.current = c;
    setBusy(true); setError(undefined);
    try {
      const response = await api.researchPlace({ executionMode: 'REAL', poiId, city, visitDate }, c.signal);
      if (!c.signal.aborted && response.data) setResult(response.data);
    } catch (e) { if (!c.signal.aborted) setError(e); }
    finally { if (!c.signal.aborted) setBusy(false); }
  }
  return <section className="mt-3 space-y-2 rounded-[12px] bg-white/70 p-3 text-[13px]">
    <div className="flex items-center justify-between gap-2"><p className="font-medium">联网资料</p>
      {poiId && <button className="text-brand disabled:opacity-50" disabled={busy} onClick={search}>{busy ? '正在搜索…' : result ? '重新搜索' : '联网查资料'}</button>}</div>
    {result ? <>
      <p className="text-ink-soft">{result.message}</p>
      {result.references.map((r, i) => {
        const url = safeSourceUrl(r.url);
        return url ? <div key={i} className="space-y-1 border-t border-sand pt-2">
          <a className="text-brand underline" href={url} target="_blank" rel="noopener noreferrer">{r.title}</a>
          <p className="line-clamp-3 whitespace-pre-line text-ink-soft">{r.snippet}</p>
          <p className="text-[11px] text-ink-faint">{new URL(url).hostname} · 搜索参考</p>
        </div> : null;
      })}
      <p className="text-[11px] text-ink-faint">查询于 {fmtDateTime(result.checkedAt)} · 以到访日景区公告为准</p>
    </> : <p className="text-ink-faint">查询景点开放、门票与预约资料，查看原始来源。</p>}
    {error != null && <ErrorBox error={error} compact />}
  </section>;
}
