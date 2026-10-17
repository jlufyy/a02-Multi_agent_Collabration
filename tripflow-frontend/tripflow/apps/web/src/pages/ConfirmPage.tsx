import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import type { TripRequirements, PlaceReference, CompanionPreference, TravelIntent, FixedConstraint, Place, TravelMode, IntentType } from '@tripflow/contracts';
import { useTrips } from '../store/tripStore';
import { Icon } from '../components/Icon';
import { PlacePicker } from '../components/PlacePicker';
import { Toggle } from '../components/ui';
import { INTENT_LABEL, MODE_LABEL, dayCount, emptyRequirements, requirementProblems } from '../lib/requirements';
import { uid } from '../lib/id';
import { planTime } from '../lib/time';

const toLocal = (iso?: string) => (iso ? new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00+08:00` : undefined);

export function ConfirmPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const saveDraft = useTrips((s) => s.saveDraft);
  const [r, setR] = useState<TripRequirements>(() => trip?.draft.requirements ?? emptyRequirements());
  const [picker, setPicker] = useState<{ query?: string; candidates?: Place[]; onPick: (p: Place) => void }>();
  const [showErr, setShowErr] = useState(false);
  const [more, setMore] = useState(false);
  const parse = trip?.draft.parse;

  useEffect(() => {
    if (!trip) return;
    const h = setTimeout(() => saveDraft(tripId, { requirements: { ...r, confirmed: false } }).catch(() => undefined), 500);
    return () => clearTimeout(h);
  }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  const problems = useMemo(() => requirementProblems(r), [r]);
  if (!trip) return <Navigate to="/" replace />;
  if (trip.real.plan) return <Navigate to={`/trip/${tripId}`} replace />;

  const up = <K extends keyof TripRequirements>(k: K, v: TripRequirements[K]) => setR((x) => ({ ...x, [k]: v }));
  const uncertain = (path: string) => parse?.uncertainFields.find((u) => u.fieldPath === path || u.fieldPath.startsWith(path + '.'));
  const missing = (path: string) => parse?.missingFields.includes(path);
  const ctx = { executionMode: 'REAL' as const };
  const n = dayCount(r);

  async function confirm() {
    if (Object.keys(problems).length) { setShowErr(true); return; }
    const confirmed: TripRequirements = { ...r, confirmed: true, version: r.version + 1,
      intents: r.intents.map((i) => ({ ...i, confirmed: i.status !== 'CANCELLED' })) };
    await saveDraft(tripId, { requirements: confirmed });
    nav(`/trip/${tripId}/planning`);
  }

  const meta = (path: string) => ({ uncertain: uncertain(path)?.reason, missing: missing(path), problem: showErr ? problems[path] : undefined });

  const bare = 'w-full bg-transparent text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-ink-faint';
  const activeIntents = r.intents.filter((x) => x.status !== 'CANCELLED').length;
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-[calc(14px+var(--safe-t))]">
        <button className="absolute left-3 flex h-10 w-10 items-center justify-center" onClick={() => nav(`/trip/${tripId}/input`)} aria-label="返回"><Icon name="back" /></button>
        <h1 className="text-[17px] font-semibold">确认你的旅行需求</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 pb-8">
        {parse && (parse.missingFields.length > 0 || parse.uncertainFields.length > 0) && (
          <p className="rounded-[12px] bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">AI 标记了 {parse.missingFields.length} 项缺失、{parse.uncertainFields.length} 项不确定，请核对带标记的字段。</p>
        )}

        <Row icon="pin" {...meta('destinationCity')} label="目的地">
          <input className={bare} value={r.destinationCity ?? ''} onChange={(e) => up('destinationCity', e.target.value)} placeholder="如：北京" aria-label="目的地城市" />
        </Row>
        <Row icon="calendar" {...meta('startDate')} problem={showErr ? problems.startDate ?? problems.endDate : undefined} label={`出行时间${n ? `（${n}天）` : ''}`}>
          <div className="flex items-center gap-1.5">
            <input type="date" className={`${bare} !w-auto`} value={r.startDate ?? ''} onChange={(e) => up('startDate', e.target.value || undefined)} aria-label="出发日期" />
            <span className="text-ink-faint">–</span>
            <input type="date" className={`${bare} !w-auto`} value={r.endDate ?? ''} min={r.startDate} onChange={(e) => up('endDate', e.target.value || undefined)} aria-label="结束日期" />
          </div>
        </Row>
        <Row icon="users" {...meta('travelerCount')} label="出行人数">
          <div className="flex items-center gap-2">
            <input type="number" min={1} inputMode="numeric" className={`${bare} !w-12`} value={r.travelerCount ?? ''} aria-label="出行人数"
              onChange={(e) => up('travelerCount', e.target.value ? Number(e.target.value) : undefined)} />
            <span className="truncate text-[13px] text-ink-soft">位{r.companions.length ? `（${r.companions.map((c) => c.label).join(' + ')}）` : ''}</span>
          </div>
        </Row>
        <Row icon="wallet" {...meta('budgetCny')} label="预算（元）">
          <div className="flex items-center gap-2">
            <input type="number" min={0} inputMode="decimal" className={`${bare} flex-1`} placeholder="未指定" value={r.budgetCny ?? ''} aria-label="预算"
              onChange={(e) => up('budgetCny', e.target.value ? Number(e.target.value) : undefined)} />
            <select className="rounded-full bg-white px-2.5 py-1 text-[13px] text-ink-soft ring-1 ring-sand" value={r.budgetScope ?? ''} aria-label="预算口径"
              onChange={(e) => up('budgetScope', (e.target.value || undefined) as TripRequirements['budgetScope'])}>
              <option value="">口径</option><option value="PER_PERSON">人均</option><option value="TOTAL">总额</option>
            </select>
          </div>
        </Row>
        <Row icon="spark" {...meta('preferences')} label="兴趣偏好">
          <Tags value={r.preferences} onChange={(v) => up('preferences', v)} placeholder="添加兴趣，如 历史文化" />
        </Row>
        <Row icon="flag" label="想去的地方" action={<button className="text-[13px] text-brand" onClick={() => setPicker({ onPick: (p) => up('mustVisit', [...r.mustVisit, { query: p.name, place: p }]) })}>+ 添加</button>}>
          {r.mustVisit.length === 0 ? <span className="text-[14px] text-ink-faint">未指定</span> : (
            <div className="flex flex-wrap gap-1.5">
              {r.mustVisit.map((m, i) => (
                <span key={i} className={`chip !py-1.5 !text-[13px] ${m.place ? 'bg-brand-mist text-brand-deep' : 'bg-warn-soft text-warn'}`}>
                  {m.place?.name ?? m.query}{!m.place && '（未匹配）'}
                  <button aria-label={`移除${m.query}`} onClick={() => up('mustVisit', r.mustVisit.filter((_, j) => j !== i))}><Icon name="close" size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </Row>

        <div className="pt-3">
          <div className="mb-2 flex items-center">
            <h2 className="text-[15px] font-semibold">地点任务 <span className="font-normal text-ink-faint">{activeIntents}</span></h2>
            <button className="ml-auto text-[13px] text-brand" onClick={() => up('intents', [...r.intents, { id: uid('it'), type: 'PHOTO', userRequest: '', desiredOutputs: [], confirmed: false, status: 'PENDING', preparedContentIds: [], locked: false }])}>+ 添加</button>
          </div>
          <p className="mb-2 text-[12.5px] text-ink-faint">到达对应地点后会主动提醒并准备内容。每个任务都要匹配一个真实地点。</p>
          <div className="space-y-2.5">
            {r.intents.map((it, i) => (
              <Intent key={it.id} it={it} problem={showErr ? problems[`intents.${i}.placeId`] : undefined} uncertainReason={uncertain(`intents.${i}`)?.reason}
                candidates={uncertain(`intents.${i}`)?.candidates}
                openPicker={setPicker} onChange={(ni) => up('intents', r.intents.map((x, j) => (j === i ? ni : x)))} onRemove={() => up('intents', r.intents.filter((_, j) => j !== i))} />
            ))}
          </div>
        </div>

        <button className="flex w-full items-center gap-2 pt-3 text-[15px] font-semibold" onClick={() => setMore(!more)} aria-expanded={more}>
          更多设置 <span className="text-[12.5px] font-normal text-ink-faint">时间段、交通、同行者、固定安排</span>
          <Icon name="back" size={16} className={`ml-auto text-ink-faint transition ${more ? 'rotate-90' : '-rotate-90'}`} />
        </button>
        {more && (
          <div className="space-y-4">
            <Section title="时间与起止点">
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <Field {...meta("arrivalAt")} label="到达时间"><input type="datetime-local" className="field" value={toLocal(r.arrivalAt)} onChange={(e) => up('arrivalAt', fromLocal(e.target.value))} /></Field>
                <Field {...meta("departureAt")} label="返程时间"><input type="datetime-local" className="field" value={toLocal(r.departureAt)} onChange={(e) => up('departureAt', fromLocal(e.target.value))} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field {...meta("dailyStartTime")} label="每天开始"><input type="time" className="field" value={r.dailyStartTime ?? ''} onChange={(e) => up('dailyStartTime', e.target.value || undefined)} /></Field>
                <Field {...meta("dailyEndTime")} label="每天结束"><input type="time" className="field" value={r.dailyEndTime ?? ''} onChange={(e) => up('dailyEndTime', e.target.value || undefined)} /></Field>
              </div>
              <PlaceRefField label="起点（如酒店/车站）" value={r.startPoint} onChange={(v) => up('startPoint', v)} openPicker={setPicker} />
              <PlaceRefField label="终点" value={r.endPoint} onChange={(v) => up('endPoint', v)} openPicker={setPicker} />
            </Section>
            <Section title="预算规则">
              <Toggle checked={r.budgetIsHardLimit} onChange={(v) => up('budgetIsHardLimit', v)} label="预算是硬上限" hint="超出可信估算的方案会被阻止提交" />
              <Toggle checked={!!r.includesAccommodation} onChange={(v) => up('includesAccommodation', v)} label="包含住宿" />
              <Toggle checked={!!r.includesIntercityTransport} onChange={(v) => up('includesIntercityTransport', v)} label="包含往返大交通" />
            </Section>
            <Section title="交通与体力">
              <Field {...meta("transportModes")} label="可接受的交通方式">
                <div className="flex flex-wrap gap-2">
                  {(['TRANSIT', 'WALK', 'DRIVE'] as TravelMode[]).map((m) => {
                    const on = r.transportModes.includes(m);
                    return <button key={m} type="button" onClick={() => up('transportModes', on ? r.transportModes.filter((x) => x !== m) : [...r.transportModes, m])}
                      className={`chip !px-3.5 !py-2 !text-[14px] ${on ? 'bg-brand text-white' : 'bg-[#F5F7FA] text-ink-soft'}`}>{MODE_LABEL[m]}</button>;
                  })}
                </div>
              </Field>
              <Field {...meta("walkingTolerance")} label="步行接受度"><Tolerance value={r.walkingTolerance} onChange={(v) => up('walkingTolerance', v)} /></Field>
              <Field {...meta("specialNeeds")} label="特殊需求"><Tags value={r.specialNeeds} onChange={(v) => up('specialNeeds', v)} placeholder="如 带老人、少爬楼梯" /></Field>
              <PlaceRefList label="不想去" items={r.avoidPlaces} onChange={(v) => up('avoidPlaces', v)} openPicker={setPicker} />
            </Section>
            <Section title={`同行者（${r.companions.length}）`} action={<button className="text-[13px] text-brand" onClick={() => up('companions', [...r.companions, { id: uid('cp'), label: `同行者${r.companions.length + 1}`, interests: [], specialNeeds: [] }])}>+ 添加</button>}>
              {r.companions.length === 0 && <p className="text-[13px] text-ink-faint">可为每位同行者记录兴趣、预算与步行接受度，由你统一编辑。</p>}
              {r.companions.map((c, i) => (
                <Companion key={c.id} c={c} onChange={(nc) => up('companions', r.companions.map((x, j) => (j === i ? nc : x)))} onRemove={() => up('companions', r.companions.filter((_, j) => j !== i))} />
              ))}
            </Section>
            <Section title="固定安排 / 锁定时段" action={<button className="text-[13px] text-brand" onClick={() => up('fixedConstraints', [...r.fixedConstraints, { id: uid('fc'), startAt: r.startDate ? `${r.startDate}T12:00:00+08:00` : planTime(new Date()), reason: '', locked: true }])}>+ 添加</button>}>
              {r.fixedConstraints.length === 0 && <p className="text-[13px] text-ink-faint">如“周六 18:00 前必须到车站集合”。</p>}
              {r.fixedConstraints.map((f, i) => (
                <Fixed key={f.id} f={f} openPicker={setPicker} onChange={(nf) => up('fixedConstraints', r.fixedConstraints.map((x, j) => (j === i ? nf : x)))} onRemove={() => up('fixedConstraints', r.fixedConstraints.filter((_, j) => j !== i))} />
              ))}
            </Section>
          </div>
        )}
      </div>
      <footer className="px-5 pb-[calc(14px+var(--safe-b))] pt-3">
        {showErr && Object.keys(problems).length > 0 && <p className="mb-2 text-center text-[13px] text-danger">还有 {Object.keys(problems).length} 项需要处理</p>}
        <button className="btn-primary h-[52px] w-full text-[16px]" onClick={confirm}>开始规划行程</button>
      </footer>
      {picker && <PlacePicker open onClose={() => setPicker(undefined)} city={r.destinationCity} initialQuery={picker.query} candidates={picker.candidates} onPick={picker.onPick} ctx={ctx} />}
    </div>
  );
}

function Row({ icon, label, children, action, uncertain, missing, problem }: {
  icon: string; label: string; children: ReactNode; action?: ReactNode; uncertain?: string; missing?: boolean; problem?: string;
}) {
  return (
    <div className={`row-card !items-start ${problem ? 'ring-1 ring-danger/50' : uncertain ? 'ring-1 ring-warn/40' : ''}`}>
      <span className="row-icon mt-0.5"><Icon name={icon} size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[12px] text-ink-faint">
          {label}
          {missing && <span className="chip !py-0 bg-accent-soft text-accent">需补充</span>}
          {uncertain && <span className="chip !py-0 bg-warn-soft text-warn">AI 不确定</span>}
          {action && <span className="ml-auto">{action}</span>}
        </div>
        <div className="mt-0.5">{children}</div>
        {uncertain && <p className="mt-1 text-[12px] text-warn">{uncertain}</p>}
        {problem && <p className="mt-1 text-[12px] text-danger">{problem}</p>}
      </div>
    </div>
  );
}

function Field({ label, children, hint, uncertain, missing, problem }: { label: string; children: ReactNode; hint?: string; uncertain?: string; missing?: boolean; problem?: string }) {
  return (
    <div>
      <label className="label flex items-center gap-1.5">{label}
        {missing && <span className="chip !py-0 bg-accent-soft text-accent">需补充</span>}
        {uncertain && <span className="chip !py-0 bg-warn-soft text-warn">AI 不确定</span>}
      </label>
      {children}
      {uncertain && <p className="mt-1 text-[12px] text-warn">{uncertain}</p>}
      {hint && <p className="mt-1 text-[12px] text-ink-faint">{hint}</p>}
      {problem && <p className="mt-1 text-[12px] text-danger">{problem}</p>}
    </div>
  );
}

type OpenPicker = (p: { query?: string; candidates?: Place[]; onPick: (p: Place) => void }) => void;

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3 rounded-[16px] bg-[#F7F9FC] p-4">
      <div className="flex items-center"><h2 className="section-title">{title}</h2><span className="ml-auto">{action}</span></div>
      {children}
    </section>
  );
}

function Tags({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [t, setT] = useState('');
  const add = () => { const s = t.trim(); if (s && !value.includes(s)) onChange([...value, s]); setT(''); };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v) => (
        <span key={v} className="chip !py-1.5 !text-[13px] bg-brand-mist text-brand-deep">{v}<button aria-label={`移除${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><Icon name="close" size={12} /></button></span>
      ))}
      <input className="min-w-[90px] flex-1 bg-transparent py-1 outline-none" value={t} placeholder={value.length ? '' : placeholder}
        onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === '，' || e.key === ',') { e.preventDefault(); add(); } }} onBlur={add} />
    </div>
  );
}

function Tolerance({ value, onChange }: { value?: 'LOW' | 'MEDIUM' | 'HIGH'; onChange: (v?: 'LOW' | 'MEDIUM' | 'HIGH') => void }) {
  const opts = [['LOW', '少走'], ['MEDIUM', '适中'], ['HIGH', '能走']] as const;
  return (
    <div className="grid grid-cols-4 gap-1 rounded-btn bg-sand/60 p-1">
      <button type="button" className={`rounded-[10px] py-2 text-[13px] ${!value ? 'bg-card shadow-card' : 'text-ink-soft'}`} onClick={() => onChange(undefined)}>未指定</button>
      {opts.map(([k, l]) => <button type="button" key={k} className={`rounded-[10px] py-2 text-[13px] ${value === k ? 'bg-card font-medium shadow-card' : 'text-ink-soft'}`} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

function PlaceTag({ refv, onPick, onRemove }: { refv: PlaceReference; onPick: () => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-btn border border-sand bg-white px-3 py-2">
      <Icon name="pin" size={16} className={refv.place ? 'text-brand' : 'text-ink-faint'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{refv.place?.name ?? refv.query}</span>
        <span className={`block text-[11.5px] ${refv.place ? 'text-ok' : 'text-warn'}`}>{refv.place ? '已匹配真实地点' : '未匹配地点'}</span>
      </span>
      <button className="text-[13px] text-brand" onClick={onPick}>{refv.place ? '更换' : '匹配'}</button>
      {onRemove && <button aria-label="移除" className="text-ink-faint" onClick={onRemove}><Icon name="close" size={16} /></button>}
    </div>
  );
}

function PlaceRefField({ label, value, onChange, openPicker }: { label: string; value?: PlaceReference; onChange: (v?: PlaceReference) => void; openPicker: OpenPicker }) {
  return (
    <div>
      <label className="label">{label}</label>
      {value ? <PlaceTag refv={value} onPick={() => openPicker({ query: value.query, onPick: (p) => onChange({ query: value.query, place: p }) })} onRemove={() => onChange(undefined)} />
        : <button className="field text-left text-ink-faint" onClick={() => openPicker({ onPick: (p) => onChange({ query: p.name, place: p }) })}>选择地点…</button>}
    </div>
  );
}

function PlaceRefList({ label, items, onChange, openPicker }: { label: string; items: PlaceReference[]; onChange: (v: PlaceReference[]) => void; openPicker: OpenPicker }) {
  return (
    <div>
      <div className="label flex items-center">{label}<button className="ml-auto text-brand" onClick={() => openPicker({ onPick: (p) => onChange([...items, { query: p.name, place: p }]) })}>+ 添加</button></div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-[13px] text-ink-faint">未指定</p>}
        {items.map((it, i) => (
          <PlaceTag key={i} refv={it} onPick={() => openPicker({ query: it.query, onPick: (p) => onChange(items.map((x, j) => (j === i ? { query: it.query, place: p } : x))) })}
            onRemove={() => onChange(items.filter((_, j) => j !== i))} />
        ))}
      </div>
    </div>
  );
}

function Companion({ c, onChange, onRemove }: { c: CompanionPreference; onChange: (c: CompanionPreference) => void; onRemove: () => void }) {
  return (
    <div className="space-y-2 rounded-[14px] bg-[#F7F9FC] p-3">
      <div className="flex gap-2">
        <input className="field flex-1" value={c.label} onChange={(e) => onChange({ ...c, label: e.target.value })} aria-label="称呼" />
        <input className="field w-28" type="number" min={0} placeholder="个人预算" value={c.personalBudgetCny ?? ''} onChange={(e) => onChange({ ...c, personalBudgetCny: e.target.value ? Number(e.target.value) : undefined })} />
        <button className="text-ink-faint" aria-label="删除同行者" onClick={onRemove}><Icon name="trash" size={18} /></button>
      </div>
      <Tags value={c.interests} onChange={(v) => onChange({ ...c, interests: v })} placeholder="兴趣" />
      <Tags value={c.specialNeeds} onChange={(v) => onChange({ ...c, specialNeeds: v })} placeholder="特殊需求" />
      <Tolerance value={c.walkingTolerance} onChange={(v) => onChange({ ...c, walkingTolerance: v })} />
    </div>
  );
}

function Fixed({ f, onChange, onRemove, openPicker }: { f: FixedConstraint; onChange: (f: FixedConstraint) => void; onRemove: () => void; openPicker: OpenPicker }) {
  return (
    <div className="space-y-2 rounded-[14px] bg-[#F7F9FC] p-3">
      <div className="flex gap-2">
        <input className="field flex-1" value={f.reason} placeholder="说明，如 集合/演出/预约" onChange={(e) => onChange({ ...f, reason: e.target.value })} />
        <button className="text-ink-faint" aria-label="删除" onClick={onRemove}><Icon name="trash" size={18} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="datetime-local" className="field" value={toLocal(f.startAt)} onChange={(e) => onChange({ ...f, startAt: fromLocal(e.target.value) ?? f.startAt })} aria-label="开始" />
        <input type="datetime-local" className="field" value={toLocal(f.endAt)} onChange={(e) => onChange({ ...f, endAt: fromLocal(e.target.value) })} aria-label="结束" />
      </div>
      {f.place ? <PlaceTag refv={f.place} onPick={() => openPicker({ query: f.place?.query, onPick: (p) => onChange({ ...f, place: { query: p.name, place: p } }) })} onRemove={() => onChange({ ...f, place: undefined })} />
        : <button className="text-[13px] text-brand" onClick={() => openPicker({ onPick: (p) => onChange({ ...f, place: { query: p.name, place: p } }) })}>+ 关联地点</button>}
      <Toggle checked={f.locked} onChange={(v) => onChange({ ...f, locked: v })} label="锁定（不可被自动调整）" />
    </div>
  );
}

function Intent({ it, onChange, onRemove, openPicker, problem, uncertainReason, candidates }: {
  it: TravelIntent; onChange: (i: TravelIntent) => void; onRemove: () => void; openPicker: OpenPicker; problem?: string; uncertainReason?: string; candidates?: Place[];
}) {
  const [placeName, setPlaceName] = useState<string>();
  const cancelled = it.status === 'CANCELLED';
  return (
    <div className={`space-y-2 rounded-[14px] bg-[#F7F9FC] p-3 ${cancelled ? 'opacity-50' : ''}`}>
      <div className="flex gap-2">
        <select className="field w-28" value={it.type} onChange={(e) => onChange({ ...it, type: e.target.value as IntentType })}>
          {Object.entries(INTENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="field flex-1" placeholder="地点（如 天安门）" value={it.placeQuery ?? ''} onChange={(e) => onChange({ ...it, placeQuery: e.target.value, placeId: undefined })} />
        <button className="text-ink-faint" aria-label="删除任务" onClick={onRemove}><Icon name="trash" size={18} /></button>
      </div>
      <textarea className="field resize-none" rows={2} placeholder="想做什么，如 录一段 1 分钟的纪念演讲视频" value={it.userRequest} onChange={(e) => onChange({ ...it, userRequest: e.target.value })} />
      <Tags value={it.desiredOutputs} onChange={(v) => onChange({ ...it, desiredOutputs: v })} placeholder="希望准备的内容，如 讲稿、拍摄清单" />
      <div className="flex items-center gap-2">
        <span className={`text-[13px] ${it.placeId ? 'text-ok' : 'text-warn'}`}>{it.placeId ? `已匹配：${placeName ?? it.placeQuery ?? it.placeId}` : '未匹配真实地点'}</span>
        <button className="ml-auto text-[13px] text-brand" onClick={() => openPicker({ query: it.placeQuery, candidates, onPick: (p) => { setPlaceName(p.name); onChange({ ...it, placeId: p.poiId, placeQuery: it.placeQuery || p.name }); } })}>
          {it.placeId ? '更换地点' : '匹配地点'}
        </button>
      </div>
      {uncertainReason && <p className="text-[12px] text-warn">AI 不确定：{uncertainReason}</p>}
      {problem && <p className="text-[12px] text-danger">{problem}</p>}
      <Toggle checked={it.locked} onChange={(v) => onChange({ ...it, locked: v })} label="锁定该任务" hint="调整行程时不允许删除或移动关联活动" />
      <Toggle checked={!cancelled} onChange={(v) => onChange({ ...it, status: v ? 'PENDING' : 'CANCELLED' })} label="启用" />
      <p className="text-[11.5px] leading-snug text-ink-faint">拍摄位置及现场管理规定以官方最新信息为准；系统只提供一般准备与文案辅助。</p>
    </div>
  );
}
