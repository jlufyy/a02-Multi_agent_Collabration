import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NearbyCandidate } from '@tripflow/contracts';
import { RestaurantCard } from '../components/FoodPanel';
import { trip } from './fixtures';
import { normalizeDiningRequirements } from '../lib/requirements';

// Node-only rendering assertions do not initialize the browser-only map SDK.
vi.mock('@amap/amap-jsapi-loader', () => ({ default: { load: vi.fn() } }));

describe('location-aware food choice', () => {
  const plan = trip();
  const place = { ...plan.activities[0].place, name: '合成湘菜馆(北湖店)', address: '合成测试街道100号', category: 'RESTAURANT' as const };
  const candidate: NearbyCandidate = { place, distanceMeters: 120, distanceEvidence: { provider: 'SYNTHETIC', status: 'ESTIMATED' },
    relevanceReason: '按湘菜检索', costStatus: 'UNKNOWN', preferenceMatches: ['按湘菜检索'] };
  it('shows the address and distinguishes straight-line distance from actual road travel', () => {
    const html = renderToStaticMarkup(<RestaurantCard candidate={candidate} expanded={false} plan={plan} onExpand={() => undefined} onChoose={() => undefined} busy={false} />);
    expect(html).toContain('合成测试街道100号');
    expect(html).toContain('直线约');
    expect(html).toContain('不代表实际路程');
    expect(html).toContain('步行路线暂未核验');
    expect(html).not.toContain('加入当天行程');
  });
  it('shows measured walk time, reference origin and sourced reviews before adding', () => {
    const withSources: NearbyCandidate = { ...candidate, route: { mode: 'WALK', durationMin: 12, distanceMeters: 800, evidence: { provider: 'amap', status: 'VERIFIED' } },
      reviewResearch: { status: 'AVAILABLE', query: '合成测试', checkedAt: '2026-10-17T00:00:00Z', message: '合成资料', references: [{ title: '合成来源', url: 'https://example.org/review', snippet: '合成测试摘要', evidence: { provider: 'tavily', status: 'ESTIMATED' } }] } };
    const html = renderToStaticMarkup(<RestaurantCard candidate={withSources} expanded plan={plan} anchor={{ location: place.location, label: '北湖公园' }} onExpand={() => undefined} onChoose={() => undefined} busy={false} />);
    expect(html).toContain('12分钟');
    expect(html).toContain('北湖公园');
    expect(html).toContain('https://example.org/review');
    expect(html).toContain('公开评价参考');
    expect(html).toContain('加入当天行程并核验时间');
  });
  it('keeps generic vicinity dining out of mandatory place-picking', () => {
    const requirements = { ...plan.requirements, intents: [{ id: 'food', type: 'FOOD' as const, placeQuery: '北湖公园附近餐厅', userRequest: '吃晚饭', status: 'PENDING' as const, confirmed: false, locked: false, desiredOutputs: [], preparedContentIds: [] }] };
    expect(normalizeDiningRequirements(requirements).intents).toHaveLength(0);
  });
});
