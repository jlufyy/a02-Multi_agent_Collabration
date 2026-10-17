import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewPanel } from '../components/PreviewPanel';
import { PlaceThumb } from '../components/Illustrations';
import type { useEditFlow } from '../lib/useEditFlow';
import { proposal, trip } from './fixtures';
import { buildConversation } from '../lib/conversation';

describe('trip UX recovery', () => {
  it('includes the assistant clarification options in multi-turn AI context', () => {
    expect(buildConversation([{ role: 'user', text: '修改时间' }, { role: 'clarify', questions: ['A：提前，B：延后？'] },
      { role: 'user', text: '选A' }])).toEqual([{ role: 'user', content: '修改时间' }, { role: 'assistant', content: 'A：提前，B：延后？' }, { role: 'user', content: '选A' }]);
  });
  it('keeps editable conflict recovery controls beside the blocked confirmation', () => {
    const current = trip();
    const p = proposal(current, { status: 'INFEASIBLE', committable: false, hardViolations: [{ code: 'ACTIVITY_OVERLAP', message: '重叠', activityIds: ['a', 'b'] }] });
    const flow = { propose: () => undefined, discard: () => undefined, confirm: () => undefined,
      proposeJob: { running: false }, validateJob: { running: false } } as unknown as ReturnType<typeof useEditFlow>;
    const html = renderToStaticMarkup(<PreviewPanel current={current} pending={{ proposal: p, origin: 'DETAIL', createdAt: '' }} flow={flow} onClosed={() => undefined} />);
    expect(html).toContain('调整冲突后继续');
    expect(html).toContain('Pa 日期');
    expect(html).toContain('Pa 开始时间');
    expect(html).toContain('按此调整重新计算');
    expect(html).toContain('移除此活动');
    expect(html).toContain('重新核验并排程');
    expect(html).toContain('无法应用（存在冲突）');
  });

  it('renders a provider photo instead of a giant name initial', () => {
    const place = { ...trip().activities[0].place, name: '八达岭长城', photoUrls: ['https://store.is.autonavi.com/showpic/synthetic'] };
    const html = renderToStaticMarkup(<PlaceThumb name={place.name} place={place} />);
    expect(html).toContain('<img');
    expect(html).toContain('八达岭长城 景点照片');
    expect(html).not.toContain('>八<');
  });
});
