import { useEffect, useRef } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from './dndModifiers';
import { CSS } from '@dnd-kit/utilities';
import type { ItineraryActivity, TravelSegment, BoundarySegment, TravelIntent, ActivityProgress } from '@tripflow/contracts';
import { Icon } from './Icon';
import { PlaceThumb } from './Illustrations';
import { DATA_LABEL, fmtTime, fmtMin } from './ui';
import { MODE_LABEL, INTENT_LABEL } from '../lib/requirements';

export const PROGRESS_LABEL: Record<ActivityProgress, string> = {
  NOT_STARTED: '未开始', APPROACHING: '接近中', ARRIVED: '已到达', VISITING: '游览中', INFERRED_COMPLETE: '推定已离开', LOCATION_UNKNOWN: '位置未知',
};

type Props = {
  activities: ItineraryActivity[];
  segments: TravelSegment[];
  boundary: BoundarySegment[];
  intents: TravelIntent[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onReorder: (activityId: string, toIndex: number) => void;
  onDragState: (dragging: boolean) => void;
  traveling: boolean;
  onProgressTap?: (id: string) => void;
  locked: boolean;
  tempOrder?: boolean;
};

export function Timeline(p: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const refs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    // 地图 Marker → 卡片：滚动到对应卡片
    if (p.selectedId) refs.current[p.selectedId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [p.selectedId]);

  const start = p.boundary.find((b) => b.from.kind === 'START_POINT');
  const end = p.boundary.find((b) => b.to.kind === 'END_POINT');

  function onEnd(e: DragEndEvent) {
    p.onDragState(false);
    if (!e.over || e.active.id === e.over.id) return;
    const to = p.activities.findIndex((a) => a.id === e.over!.id);
    p.onReorder(String(e.active.id), to);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]}
      onDragStart={() => p.onDragState(true)} onDragCancel={() => p.onDragState(false)} onDragEnd={onEnd}>
      {start && <BoundaryRow seg={start} label={`从 ${start.from.place.name} 出发`} />}
      <SortableContext items={p.activities.map((a) => a.id)} strategy={verticalListSortingStrategy}>
        <ol className="relative before:absolute before:bottom-6 before:left-[17px] before:top-6 before:w-[2px] before:rounded-full before:bg-brand/25">
          {p.activities.map((a, i) => {
            const next = p.activities[i + 1];
            const seg = next && p.segments.find((s) => s.fromActivityId === a.id && s.toActivityId === next.id);
            return (
              <li key={a.id} ref={(n) => { refs.current[a.id] = n; }}>
                <Card a={a} idx={i} {...p} />
                {next && <SegmentRow seg={seg} tempOrder={p.tempOrder} />}
              </li>
            );
          })}
        </ol>
      </SortableContext>
      {end && <BoundaryRow seg={end} label={`前往 ${end.to.place.name}`} />}
      {p.activities.length === 0 && <p className="py-8 text-center text-[14px] text-ink-faint">这一天还没有安排。可以用 AI 添加地点。</p>}
    </DndContext>
  );
}

function Card({ a, idx, selectedId, onSelect, onOpen, intents, traveling, onProgressTap, locked: editingLocked }: Props & { a: ItineraryActivity; idx: number }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: editingLocked || a.locked });
  const sel = a.id === selectedId;
  const its = intents.filter((x) => a.intentIds.includes(x.id) && x.status !== 'CANCELLED');
  const here = a.progress === 'ARRIVED' || a.progress === 'VISITING';
  const done = a.progress === 'INFERRED_COMPLETE';
  const unverifiedHours = a.place.openingHours && a.place.openingHours.evidence.status !== 'VERIFIED';
  const tags = [
    ...its.map((x) => ({ t: `${INTENT_LABEL[x.type]}任务`, c: 'bg-accent-soft text-accent' })),
    ...(a.mandatory ? [{ t: '必去', c: 'bg-brand-mist text-brand' }] : []),
    ...(a.locked ? [{ t: '已锁定', c: 'bg-[#F2F4F7] text-ink-soft' }] : []),
    ...(unverifiedHours ? [{ t: '营业待核验', c: 'bg-warn-soft text-warn' }] : []),
  ];
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative flex items-center rounded-[16px] transition-shadow ${isDragging ? 'z-10 bg-white shadow-float' : sel ? 'bg-brand-mist/70' : ''}`}>
      {/* 时间线编号 */}
      <span className={`relative z-[1] ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ring-4 ring-white
        ${done ? 'bg-sand text-ink-soft' : here ? 'bg-ok text-white' : 'bg-brand text-white'}`}>{done ? <Icon name="check" size={13} stroke={2.6} /> : idx + 1}</span>
      <button className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 text-left" onClick={() => (sel ? onOpen(a.id) : onSelect(a.id))} aria-label={`${a.place.name}，${sel ? '查看详情' : '选中'}`}>
        <PlaceThumb name={a.place.name} size={64} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] font-semibold ${done ? 'text-ink-soft' : ''}`}>{a.place.name}</span>
          <span className="block text-[13px] text-ink-soft">{fmtTime(a.startAt)} - {fmtTime(a.endAt)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {tags.map((x) => <span key={x.t} className={`rounded-[6px] px-1.5 py-0.5 text-[11px] ${x.c}`}>{x.t}</span>)}
            {traveling && (
              <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onProgressTap?.(a.id); }}
                className={`rounded-[6px] px-1.5 py-0.5 text-[11px] ${here ? 'bg-ok-soft text-ok' : a.progress === 'LOCATION_UNKNOWN' ? 'bg-warn-soft text-warn' : 'bg-[#F2F4F7] text-ink-soft'}`}>{PROGRESS_LABEL[a.progress]}</span>
            )}
          </span>
        </span>
      </button>
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={editingLocked || a.locked}
        aria-label={a.locked ? '已锁定，不能拖动' : `拖动调整 ${a.place.name} 的顺序`}
        className="flex h-14 w-10 shrink-0 touch-none items-center justify-center text-ink/25 active:text-brand disabled:text-ink/10">
        {a.locked ? <Icon name="lock" size={15} /> : <Icon name="grip" size={20} stroke={3} />}
      </button>
    </div>
  );
}

function SegmentRow({ seg, tempOrder }: { seg?: TravelSegment; tempOrder?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 py-1 pl-[52px] text-[12px] text-ink-faint">
      {tempOrder ? <span className="text-accent">顺序已变，交通待重新计算…</span>
        : seg ? (
          <>
            <Icon name={seg.mode === 'WALK' ? 'walk' : 'route'} size={13} />
            <span>{MODE_LABEL[seg.mode]} {fmtMin(seg.durationMin)}{seg.distanceMeters !== undefined ? ` · ${(seg.distanceMeters / 1000).toFixed(1)}km` : ''}</span>
            {seg.evidence.status !== 'VERIFIED' && <span>· {DATA_LABEL[seg.evidence.status]}</span>}
          </>
        ) : <span className="text-warn">路线待核验</span>}
    </div>
  );
}

function BoundaryRow({ seg, label }: { seg: BoundarySegment; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-ink-faint">
      <Icon name="pin" size={14} className="text-accent" />
      <span className="truncate">{label}</span>
      <span className="ml-auto shrink-0">{MODE_LABEL[seg.mode]} · {fmtMin(seg.durationMin)}</span>
      {seg.evidence.status !== 'VERIFIED' && <span>· {DATA_LABEL[seg.evidence.status]}</span>}
    </div>
  );
}
