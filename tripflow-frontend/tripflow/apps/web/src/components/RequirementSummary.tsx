import type { ParseResult, TripRequirements } from '@tripflow/contracts';
import { dayCount, MODE_LABEL } from '../lib/requirements';

export function RequirementSummary({ r, sources = {}, onEdit }: { r: TripRequirements; sources?: ParseResult['fieldSources']; onEdit: () => void }) {
  const items: [string, string, string][] = [
    ['destinationCity', '目的地', r.destinationCity ?? '待补充'],
    ['startDate', '日期', r.startDate ? `${r.startDate} 至 ${r.endDate ?? '待定'}${dayCount(r) ? ` · ${dayCount(r)}天` : ''}` : '待补充'],
    ['travelerCount', '人数', r.travelerCount ? `${r.travelerCount}人` : '待补充'],
    ['transportModes', '交通', r.transportModes.map((m) => MODE_LABEL[m]).join(' / ') || '待选择'],
    ['budgetCny', '预算', r.budgetCny === undefined ? '未指定' : `${r.budgetCny}元${r.budgetScope === 'PER_PERSON' ? '/人' : r.budgetScope === 'TOTAL' ? '总额' : '（口径待定）'}${r.budgetIsHardLimit ? ' · 硬上限' : ''}`],
    ['preferences', '偏好', [...r.preferences, ...r.specialNeeds, ...(r.walkingTolerance === 'LOW' ? ['少走路'] : [])].join('、') || '未指定'],
    ['mustVisit', '必去', r.mustVisit.map((p) => p.place?.name ?? p.query).join('、') || '由规划推荐'],
  ];
  return <section className="rounded-[18px] bg-[#F5F7FA] p-4" aria-label="旅行需求摘要">
    <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">旅行需求摘要</h2><button className="text-[13px] text-brand" onClick={onEdit}>查看 / 高级编辑</button></div>
    <dl className="space-y-2 text-[14px]">{items.map(([key, label, value]) => <div key={key} className="flex gap-3"><dt className="w-12 shrink-0 text-ink-faint">{label}</dt><dd>{value}{sources[key] && sources[key] !== 'USER' && <span className="ml-2 text-[12px] text-warn">{sources[key] === 'SUGGESTED' ? 'AI建议' : '待确认推断'}</span>}</dd></div>)}</dl>
    {r.intents.filter((i) => i.status !== 'CANCELLED').map((i) => <p key={i.id} className="mt-2 text-[13px] text-ink-soft">地点任务：{i.placeQuery ?? '待选地点'} · {i.userRequest}</p>)}
    <p className="mt-3 text-[12px] text-ink-faint">可继续说“改成周日”“我们三个人”或纠正任一条件。确认摘要后开始规划。</p>
  </section>;
}
