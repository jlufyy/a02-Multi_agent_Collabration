import { useMemo, useRef, useState } from 'react';
import type { NormalizedLocationEvent, GeoPoint, TripState } from '@tripflow/contracts';
import { offsetPoint, interpolateTrack } from '@tripflow/context-engine';
import { useTrips } from '../store/tripStore';
import { fmtTime, fmtDateTime, toast } from './ui';
import { Icon } from './Icon';
import { uid } from '../lib/id';
import type { useTravel } from '../lib/useTravel';

/**
 * P12 演示控制台：注入带时间戳的连续样本 / 带证据的风险事件，驱动同一套状态机与真实 Agent 调用。
 * 不提供“直接标记到达”的按钮——到达必须经过驻留判定。
 */
export function DemoConsole({ tripId, plan, travelDay, travel, onClose }: {
  tripId: string; plan: TripState; travelDay: number; travel: ReturnType<typeof useTravel>; onClose: () => void;
}) {
  const trip = useTrips((s) => s.trips[tripId]);
  const startDemo = useTrips((s) => s.startDemo);
  const stopDemo = useTrips((s) => s.stopDemo);
  const advance = useTrips((s) => s.advanceSimClock);
  const day = useMemo(() => plan.activities.filter((a) => a.dayIndex === travelDay).sort((a, b) => a.orderIndex - b.orderIndex), [plan, travelDay]);
  const [target, setTarget] = useState(day[0]?.id);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [riskMsg, setRiskMsg] = useState('');
  const [speed, setSpeed] = useState(1);
  const pos = useRef<GeoPoint>();
  const demo = trip?.demo;
  const act = day.find((a) => a.id === target);
  const policy = travel.policy;

  const note = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${s}`, ...l].slice(0, 40));

  async function play(points: GeoPoint[], stepSec: number, extra: Partial<NormalizedLocationEvent> = {}) {
    if (!demo) return;
    setRunning(true);
    try {
      for (const p of points) {
        const ts = advance(tripId, stepSec);
        const r = travel.feed({ sampleId: uid('sim'), tripId, source: 'SIMULATED', demoRunId: demo.demoRunId, location: p,
          accuracyMeters: 18, timestamp: ts, pageVisible: true, ...extra });
        pos.current = p;
        const evs = (r.events ?? []).map((e) => e.type).join(',');
        note(`样本 @${fmtTime(ts)}${r.notes.length ? ' · ' + r.notes.join(',') : ''}${evs ? ' → ' + evs : ''}`);
        await new Promise((res) => setTimeout(res, 300 / speed));
      }
    } finally { setRunning(false); }
  }

  const approach = () => {
    if (!act) return;
    const from = pos.current ?? offsetPoint(act.place.location, 1200, 200);
    const near = offsetPoint(act.place.location, 60, 30);
    const steps = Math.ceil((policy.arrivalDwellSeconds + 40) / 20);
    play([...interpolateTrack(from, near, 6), ...Array.from({ length: Math.max(steps, policy.minValidSamples + 1) }, (_, i) => offsetPoint(near, (i % 3) * 8, i * 40))], 20);
  };
  const leave = () => {
    if (!act) return;
    const from = pos.current ?? act.place.location;
    const far = offsetPoint(act.place.location, policy.departureRadiusMeters + 300, 120);
    const steps = Math.ceil((policy.departureDwellSeconds + 40) / 20);
    play([...interpolateTrack(from, far, 4), ...Array.from({ length: Math.max(steps, policy.minValidSamples + 1) }, () => far)], 20);
  };
  const jump = () => { const base = pos.current ?? act?.place.location; if (base) play([offsetPoint(base, 5000, 60)], 5); };
  const lowAcc = () => { const base = pos.current ?? act?.place.location; if (base) play([base], 10, { accuracyMeters: 600 }); };
  const hide = () => { const base = pos.current ?? act?.place.location; if (base) play([base], 30, { pageVisible: false }); };

  const SCENES = [
    { key: 'WEATHER', label: '天气变化', icon: 'info', code: 'WEATHER_ALERT', msg: (n: string) => `${n} 附近预计有降雨，户外游览可能受影响` },
    { key: 'CROWD', label: '景点人流', icon: 'users', code: 'CROWD_ALERT', msg: (n: string) => `${n} 当前游客较多，建议错峰或调整顺序` },
    { key: 'DELAY', label: '交通延误', icon: 'route', code: 'TIME_WINDOW_VIOLATION', msg: (n: string) => `${n} 之后的安排可能来不及：预计晚到约 25 分钟` },
  ] as const;
  function risk(scene: (typeof SCENES)[number]) {
    if (!demo || !act) return;
    const msg = riskMsg.trim() || scene.msg(act.place.name);
    const ts = advance(tripId, 0);
    travel.injectRisk({ code: scene.code, message: msg, activityIds: [act.id],
      evidence: [{ provider: '演示控制台', status: 'ESTIMATED', fetchedAt: ts, note: '模拟事件，非真实数据' }] }, ts);
    note(`注入场景「${scene.label}」：${msg}`);
    setRiskMsg('');
  }

  const recent = (trip?.demo?.eventLog ?? []).slice(-12).reverse();
  const Sw = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
    <button type="button" role="switch" aria-checked={on} aria-label="模拟模式" onClick={() => set(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition ${on ? 'bg-brand' : 'bg-[#E3E7ED]'}`}>
      <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[23px]' : 'left-[3px]'}`} />
    </button>
  );

  return (
    <div className="animate-rise fixed inset-0 z-[60] mx-auto flex max-w-[560px] flex-col bg-paper" role="dialog" aria-modal="true" aria-label="演示控制台">
      <header className="relative px-4 pb-3 pt-[calc(14px+var(--safe-t))] text-center">
        <button className="absolute left-3 top-[calc(12px+var(--safe-t))] flex h-10 w-10 items-center justify-center" onClick={onClose} aria-label="关闭"><Icon name="back" /></button>
        <h1 className="text-[17px] font-semibold">演示控制台</h1>
        <p className="text-[12px] text-ink-faint">仅用于演示，不会保存到真实行程</p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6">
        <div className="flex items-center gap-3 rounded-[16px] bg-white px-4 py-3.5">
          <Icon name="flask" size={18} className="text-brand" />
          <span className="flex-1 text-[15px]">模拟模式</span>
          <Sw on={!!demo} set={async (v) => {
            if (v) { await startDemo(tripId); toast('演示运行已开始', 'warn'); }
            else { await stopDemo(tripId); pos.current = undefined; setLog([]); toast('已退出演示，模拟记录已清除'); }
          }} />
        </div>
        {!demo ? (
          <p className="rounded-[16px] bg-white p-4 text-[13.5px] leading-relaxed text-ink-soft">
            打开后会创建当前行程的独立副本（计划、撤销记录、到达记录都隔离），用模拟位置和场景驱动<b className="text-ink">同一套</b>到达判定与真实 AI 服务。演示期间暂停真实定位，关闭即清除全部模拟记录。
          </p>
        ) : (
          <>
            <div className="rounded-[16px] bg-white px-4 py-3.5">
              <p className="text-[15px]">模拟路线</p>
              <select className="mt-2 w-full rounded-[12px] bg-[#F3F5F8] px-3 py-2.5 text-[14px]" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="目标地点">
                {day.map((a, i) => <option key={a.id} value={a.id}>{i + 1}. {a.place.name}</option>)}
              </select>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button className="h-10 rounded-full bg-brand text-[14px] text-white disabled:opacity-40" disabled={running || !act} onClick={approach}>接近 → 驻留</button>
                <button className="h-10 rounded-full bg-brand-mist text-[14px] text-brand disabled:opacity-40" disabled={running || !act} onClick={leave}>持续离开</button>
              </div>
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5">
              <div className="flex items-center"><span className="flex-1 text-[15px]">模拟速度</span><span className="text-[13px] text-ink-faint">{speed}x（仅影响播放快慢，不改判定参数）</span></div>
              <input type="range" min={1} max={4} step={1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-2 w-full accent-[#2F7CF6]" aria-label="模拟速度" />
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5">
              <p className="text-[15px]">场景注入</p>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                {SCENES.map((sc) => (
                  <button key={sc.key} className="flex h-10 items-center justify-center gap-1 rounded-[12px] bg-[#F3F5F8] text-[13.5px] disabled:opacity-40" disabled={!act} onClick={() => risk(sc)}>
                    <Icon name={sc.icon} size={14} />{sc.label}
                  </button>
                ))}
              </div>
              <input className="mt-2 w-full rounded-[12px] bg-[#F3F5F8] px-3 py-2 text-[13px] outline-none" value={riskMsg} onChange={(e) => setRiskMsg(e.target.value)} placeholder="可选：自定义场景描述" />
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5">
              <p className="text-[15px]">定位异常</p>
              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <button className="h-10 rounded-[12px] bg-[#F3F5F8] text-[13px] disabled:opacity-40" disabled={running || !act} onClick={jump}>GPS 跳点 5km</button>
                <button className="h-10 rounded-[12px] bg-[#F3F5F8] text-[13px] disabled:opacity-40" disabled={running || !act} onClick={lowAcc}>低精度 600m</button>
                <button className="h-10 rounded-[12px] bg-[#F3F5F8] text-[13px] disabled:opacity-40" disabled={running || !act} onClick={hide}>进入后台</button>
              </div>
            </div>
            <div className="rounded-[16px] bg-white px-4 py-3.5">
              <p className="mb-1 text-[12px] text-ink-faint">运行 {demo.demoRunId} · 模拟时钟 {fmtDateTime(demo.simClock)} · 参数 {policy.policyVersion}</p>
              <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-[12px] bg-[#18212F] p-2.5 font-mono text-[11px] leading-relaxed text-white/90">{log.join('\n') || '尚未注入'}</pre>
              <ul className="mt-2 space-y-1 text-[12px] text-ink-soft">
                {recent.map((e) => (
                  <li key={e.logId} className="flex gap-2">
                    <span className="w-11 shrink-0 tabular-nums text-ink-faint">{fmtTime(e.occurredAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {e.event && `事件 ${e.event.type} ${plan.activities.find((a) => a.id === e.event!.activityId)?.place.name ?? ''}`}
                      {e.notification && `通知 ${e.notification.level} ${e.notification.decision}${e.notification.suppressionReason ? '（' + e.notification.suppressionReason + '）' : ''}${e.notification.actionTaken ? ' → ' + e.notification.actionTaken : ''}`}
                      {e.correction && `纠正 ${e.correction.previous} → ${e.correction.next}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <button className="h-10 w-full rounded-full bg-white text-[14px] text-ink-soft" onClick={async () => { await stopDemo(tripId); await startDemo(tripId); pos.current = undefined; setLog([]); toast('演示已重置'); }}>重置演示</button>
          </>
        )}
      </div>
      {demo && (
        <footer className="px-5 pb-[calc(14px+var(--safe-b))] pt-2">
          <button className="h-[50px] w-full rounded-full bg-danger text-[16px] font-medium text-white" onClick={async () => { await stopDemo(tripId); pos.current = undefined; toast('已退出演示，模拟记录已清除'); onClose(); }}>结束演示</button>
        </footer>
      )}
    </div>
  );
}
