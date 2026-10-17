import { useState } from 'react';
import type { NotificationAction } from '@tripflow/contracts';
import type { QueuedCard } from '@tripflow/context-engine';
import { Icon } from './Icon';
import { Logo } from './Illustrations';
import { EvidenceList } from './ui';

const ACTION_LABEL: Record<NotificationAction, string> = {
  VIEW_CONTENT: '查看内容', VIEW_SCRIPT: '查看讲稿', VIEW_SHOOTING_CHECKLIST: '拍摄清单', REMIND_LATER: '稍后提醒',
  IGNORE: '忽略', VIEW_REVISION: '查看建议', VIEW_NEARBY: '看看附近', ADD_TO_PLAN: '加入行程',
};

/** P09 主动卡片：同一时间只显示一张；L1 轻提示、L2 交互任务卡、L3 风险卡视觉层级不同。 */
export function ProactiveCard({ q, onAction }: { q: QueuedCard; onAction: (a: NotificationAction, snooze?: number) => void }) {
  const c = q.decision.card;
  const [snooze, setSnooze] = useState(false);
  const [why, setWhy] = useState(false);
  const simulated = q.eventSource === 'SIMULATED';
  const actions = c.actions.filter((a) => a !== 'IGNORE' && a !== 'REMIND_LATER');

  const levelLabel = c.level === 'L3' ? '风险提醒' : c.level === 'L2' ? '你的任务' : '顺路知识';
  const levelCls = c.level === 'L3' ? 'text-danger' : c.level === 'L2' ? 'text-accent' : 'text-brand';
  const icon = c.level === 'L3' ? 'alert' : c.module === 'PERSONAL_GOAL' ? 'camera' : c.module === 'NEARBY' ? 'food' : 'book';
  const now = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

  // 设计稿 09：通知卡样式（页面内呈现；H5 不承诺锁屏推送）
  return (
    <div role={c.level === 'L3' ? 'alertdialog' : 'status'} aria-live={c.level === 'L3' ? 'assertive' : 'polite'}
      className={`animate-rise pointer-events-auto rounded-[20px] bg-white/95 p-4 shadow-[0_10px_30px_-10px_rgba(24,33,47,.35)] backdrop-blur-xl ${c.level === 'L3' ? 'ring-1 ring-danger/50' : ''}`}>
      <div className="flex items-center gap-2 text-[12px] text-ink-faint">
        <Logo size={16} /><span className="font-medium text-ink-soft">TripFlow</span><span>{now}</span>
        <span className={`ml-1 font-semibold ${levelCls}`}>{levelLabel} · {c.level}</span>
        {simulated && <span className="rounded-[6px] bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">模拟事件</span>}
        {c.level === 'L1' && <button className="-mr-1 ml-auto p-1 text-ink-faint" aria-label="忽略" onClick={() => onAction('IGNORE')}><Icon name="close" size={15} /></button>}
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <span className={`mt-0.5 shrink-0 ${levelCls}`}><Icon name={icon} size={18} /></span>
        <p className="text-[15.5px] font-semibold leading-snug">{c.title}</p>
      </div>
      {c.level === 'L3' && (
        <div className="mt-2 pl-[28px]">
          <button className="text-[12.5px] text-danger underline" onClick={() => setWhy(!why)}>{why ? '收起依据' : '为什么提醒？查看依据'}</button>
          {why && <div className="mt-2 rounded-[12px] bg-danger-soft/60 p-2.5"><EvidenceList items={c.evidence.facts} /></div>}
          <p className="mt-1 text-[12px] text-ink-faint">不会自动修改行程，调整方案需你确认。</p>
        </div>
      )}
      {snooze ? (
        <div className="mt-3 flex gap-2">
          {[10, 30, 60].map((m) => <button key={m} className="h-10 flex-1 rounded-full bg-brand-mist text-[14px] text-brand" onClick={() => onAction('REMIND_LATER', m)}>{m} 分钟后</button>)}
          <button className="h-10 rounded-full px-3 text-[14px] text-ink-soft" onClick={() => setSnooze(false)}>取消</button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          {actions.map((a, i) => (
            <button key={a} onClick={() => onAction(a)}
              className={`h-10 flex-1 rounded-full text-[14px] font-medium ${i === 0 ? (c.level === 'L3' ? 'bg-danger text-white' : 'bg-brand text-white') : 'bg-brand-mist text-brand'}`}>{ACTION_LABEL[a]}</button>
          ))}
          {c.level !== 'L1' && c.actions.includes('REMIND_LATER') && <button className="h-10 rounded-full bg-[#F2F4F7] px-4 text-[14px] text-ink-soft" onClick={() => setSnooze(true)}>稍后</button>}
          {c.level !== 'L1' && <button className="h-10 rounded-full px-3 text-[14px] text-ink-faint" onClick={() => onAction('IGNORE')}>忽略</button>}
        </div>
      )}
    </div>
  );
}
