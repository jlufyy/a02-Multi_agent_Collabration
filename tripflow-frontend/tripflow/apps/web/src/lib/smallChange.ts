import type { RevisionProposal, TripState } from '@tripflow/contracts';

/** Narrow deterministic consent gate. Model confidence alone cannot authorize direct application. */
export function canDirectApply(plan: TripState, proposal: RevisionProposal, request: string): boolean {
  if (!proposal.validation.committable || proposal.validation.status !== 'FEASIBLE' || proposal.validation.unknownChecks.length || proposal.validation.hardViolations.length) return false;
  if (proposal.operations.length !== 1 || proposal.operations[0].type !== 'UPDATE_DURATION') return false;
  const op = proposal.operations[0];
  const a = plan.activities.find((a) => a.id === op.activityId);
  if (!a || a.locked || a.bookingStatus === 'BOOKED' || a.progress !== 'NOT_STARTED' || Math.abs((Date.parse(a.endAt) - Date.parse(a.startAt)) / 60000 - op.durationMin) > 30) return false;
  if (plan.requirements.fixedConstraints.some((f) => f.activityId === a.id || f.place?.place?.poiId === a.place.poiId) || plan.intents.some((i) => i.locked && i.activityId === a.id)) return false;
  // Require the exact unique activity name and an explicit duration instruction.
  const normalized = request.replace(/[「」“”"\s，,。]/g, '');
  const name = a.place.name.replace(/\s/g, '');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalized.match(new RegExp(`^把${escaped}(?:从(\\d+)分钟)?(?:改为|改成|调整为)${op.durationMin}分钟(?:其余不变)?$`));
  if (plan.activities.filter((x) => x.place.name === a.place.name).length !== 1 || !match) return false;
  if (match[1] && Number(match[1]) !== (Date.parse(a.endAt) - Date.parse(a.startAt)) / 60000) return false;
  if (proposal.candidate.activities.length !== plan.activities.length || JSON.stringify(plan.requirements) !== JSON.stringify(proposal.candidate.requirements)) return false;
  return plan.activities.every((old) => {
    const next = proposal.candidate.activities.find((x) => x.id === old.id);
    if (!next) return false;
    return JSON.stringify(old.id === a.id ? { ...old, endAt: next.endAt } : old) === JSON.stringify(next);
  });
}
