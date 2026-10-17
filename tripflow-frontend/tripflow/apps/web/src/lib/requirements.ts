import type { Place, TripRequirements, TripState } from '@tripflow/contracts';
import { uid } from './id';

export function emptyRequirements(): TripRequirements {
  return {
    requirementsId: uid('req'), version: 1, confirmed: false, timezone: 'Asia/Shanghai',
    budgetIsHardLimit: false, transportModes: ['TRANSIT', 'WALK'], mustVisit: [], avoidPlaces: [], preferences: [],
    companions: [], specialNeeds: [], fixedConstraints: [], intents: [],
  };
}

export function dayCount(r: Pick<TripRequirements, 'startDate' | 'endDate'>): number | undefined {
  if (!r.startDate || !r.endDate) return undefined;
  return Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000) + 1;
}

/** 进入 generate 前的硬校验（附录 A.2）。返回字段路径 → 问题。 */
export function normalizeDiningRequirements(r: TripRequirements): TripRequirements {
  const generic = r.intents.filter((i) => i.type === 'FOOD' && i.status !== 'CANCELLED' && !i.placeId && !i.locked
    && (!i.placeQuery || /^.{0,40}(?:附近|周边|当地|特色)(?:的)?(?:餐厅|餐馆|饭店|美食|小吃|午餐|晚餐|用餐){1,3}(?:推荐)?$/.test(i.placeQuery)));
  if (!generic.length) return r;
  return { ...r, preferences: [...new Set([...r.preferences, ...generic.map((i) => i.userRequest)])], intents: r.intents.filter((i) => !generic.includes(i)) };
}

export function requirementProblems(r: TripRequirements): Record<string, string> {
  const p: Record<string, string> = {};
  if (!r.destinationCity?.trim()) p.destinationCity = '请填写目的地城市';
  if (!r.startDate) p.startDate = '请选择出发日期';
  if (!r.endDate) p.endDate = '请选择结束日期';
  const n = dayCount(r);
  if (n !== undefined && (n < 1 || n > 3)) p.endDate = '行程需为 1–3 天（含首尾）';
  if (!r.travelerCount || r.travelerCount < 1 || !Number.isInteger(r.travelerCount)) p.travelerCount = '人数需为正整数';
  if (r.budgetCny !== undefined && r.budgetCny < 0) p.budgetCny = '预算不能为负';
  if (r.budgetCny !== undefined && !r.budgetScope) p.budgetScope = '请选择预算按人均还是总额';
  if (!r.transportModes.length) p.transportModes = '至少选择一种交通方式';
  unresolvedPlaces(r).forEach((ref) => { p[ref.path] = `请确认“${ref.query}”的具体位置`; });
  return p;
}

/** Every user-specified location must pass the same confirmation gate. */
export function unresolvedPlaces(r: TripRequirements): { path: string; query: string }[] {
  return [
    ...(['mustVisit', 'avoidPlaces'] as const).flatMap((key) => r[key].flatMap((ref, i) => ref.place ? [] : [{ path: `${key}.${i}`, query: ref.query }])),
    ...(['startPoint', 'endPoint'] as const).flatMap((key) => r[key] && !r[key].place ? [{ path: key, query: r[key].query }] : []),
    ...r.fixedConstraints.flatMap((f, i) => f.place && !f.place.place ? [{ path: `fixedConstraints.${i}.place`, query: f.place.query }] : []),
    ...r.intents.flatMap((it, i) => it.status === 'CANCELLED' || it.placeId ? [] : [{ path: `intents.${i}`, query: it.placeQuery ?? '任务地点' }]),
  ];
}

export function bindRequirementPlace(r: TripRequirements, path: string, p: Place): TripRequirements {
  const [key, index] = path.split('.');
  if (key === 'startPoint' || key === 'endPoint') return { ...r, [key]: { ...r[key]!, place: p } };
  if (key === 'mustVisit' || key === 'avoidPlaces') return { ...r, [key]: r[key].map((ref, i) => i === Number(index) ? { ...ref, place: p } : ref) };
  if (key === 'fixedConstraints') return { ...r, fixedConstraints: r.fixedConstraints.map((f, i) => i === Number(index) ? { ...f, place: { ...f.place!, place: p } } : f) };
  return { ...r, intents: r.intents.map((it, i) => i === Number(index) ? { ...it, placeId: p.poiId, placeQuery: p.name } : it) };
}

/** requirements 的顶层投影（城市、日期、人数、预算、同行、偏好、意图必须与 requirements 一致）。 */
export function projectRequirements(t: TripState, r: TripRequirements): TripState {
  return {
    ...t, requirements: r,
    destinationCity: r.destinationCity ?? t.destinationCity, startDate: r.startDate ?? t.startDate, endDate: r.endDate ?? t.endDate,
    travelerCount: r.travelerCount ?? t.travelerCount, budgetCny: r.budgetCny, budgetScope: r.budgetScope,
    companions: r.companions, preferences: r.preferences,
  };
}

export const INTENT_LABEL: Record<string, string> = {
  KNOWLEDGE: '知识讲解', PHOTO: '拍照', VIDEO_SHOOT: '拍视频', SPEECH: '演讲', CHECK_IN: '打卡', FOOD: '美食', OTHER: '其他',
};
export const MODE_LABEL: Record<string, string> = { WALK: '步行', TRANSIT: '公共交通', DRIVE: '驾车/打车' };
