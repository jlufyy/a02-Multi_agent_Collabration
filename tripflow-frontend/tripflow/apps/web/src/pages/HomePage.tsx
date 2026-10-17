import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useTrips } from '../store/tripStore';
import { Icon } from '../components/Icon';
import { Modal, fmtDay } from '../components/ui';
import { daysOf } from '../store/planOps';
import { Logo, LandscapeHero } from '../components/Illustrations';

/** P01 首页：品牌 + 一个主按钮；已有行程列在下方。 */
export function HomePage() {
  const nav = useNavigate();
  const trips = useTrips((s) => s.trips);
  const rejected = useTrips((s) => s.rejected);
  const caps = useTrips((s) => s.capabilities);
  const capErr = useTrips((s) => s.capabilityError);
  const createTrip = useTrips((s) => s.createTrip);
  const removeTrip = useTrips((s) => s.removeTrip);
  const [demoInfo, setDemoInfo] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string>();
  const list = useMemo(() => Object.values(trips).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [trips]);

  async function create() { nav(`/trip/${await createTrip()}/input`); }
  function open(id: string) {
    const t = trips[id];
    if (t.real.plan) nav(`/trip/${id}`);
    else if (t.draft.requirements) nav(`/trip/${id}/confirm`);
    else nav(`/trip/${id}/input`);
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <section className="relative flex min-h-[100dvh] flex-col">
        <div className="pt-[calc(56px+var(--safe-t))] text-center">
          <div className="mx-auto w-fit"><Logo size={56} /></div>
          <h1 className="mt-3 text-[34px] font-bold tracking-tight text-[#13213A]">TripFlow</h1>
          <p className="mt-1 text-[14px] text-ink-faint">让旅行更简单</p>
        </div>
        <div className="relative mt-6 flex-1">
          <LandscapeHero className="absolute inset-0 h-full w-full" />
          <p className="absolute left-1/2 top-[58%] -translate-x-1/2 -rotate-[8deg] whitespace-nowrap font-hand text-[30px] leading-[1.4] text-[#22344F]">
            想去的地方，<br /><span className="ml-12">就出发吧</span>
          </p>
        </div>
        <div className="bg-white px-8 pb-[calc(20px+var(--safe-b))] pt-6">
          <button onClick={create} className="btn-primary h-14 w-full justify-between !px-7 text-[17px]">
            开始规划行程 <Icon name="back" size={20} className="rotate-180" />
          </button>
          <div className="mt-5 flex items-center justify-center gap-3 text-[12px] text-ink-faint">
            <span>智能规划</span><span className="h-3 w-px bg-sand" /><span>地图可视化</span><span className="h-3 w-px bg-sand" /><span>旅行中主动陪伴</span>
          </div>
          <div className="mt-3 flex items-center justify-center gap-3 text-[12px]">
            <span className={`inline-flex items-center gap-1 ${caps ? 'text-ok' : 'text-ink-faint'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${caps ? 'bg-ok' : 'bg-ink-faint'}`} />{caps ? '规划服务在线' : capErr ? '规划服务未连接' : '正在连接…'}
            </span>
            <button className="text-brand" onClick={() => setDemoInfo(true)}>演示模式说明</button>
          </div>
        </div>
      </section>

      {list.length > 0 && (
        <section className="bg-paper px-5 pb-[calc(28px+var(--safe-b))] pt-6">
          <h2 className="mb-3 text-[17px] font-semibold">我的行程</h2>
          <ul className="space-y-3">
            {list.map((t) => {
              const p = t.real.plan;
              const stage = p ? (p.mode === 'TRAVELING' ? '旅行中' : '已规划') : t.draft.requirements ? '待确认' : '草稿';
              return (
                <li key={t.tripId} className="card flex items-stretch overflow-hidden">
                  <button className="flex flex-1 items-center gap-3 p-4 text-left" onClick={() => open(t.tripId)}>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-mist text-brand"><Icon name="map" size={20} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[16px] font-semibold">{p?.title ?? (t.draft.requirements?.destinationCity ? `${t.draft.requirements.destinationCity}旅行` : '未命名行程')}</span>
                        <span className={`chip ${p?.mode === 'TRAVELING' ? 'bg-brand text-white' : 'bg-brand-mist text-brand'}`}>{stage}</span>
                        {t.demo && <span className="chip bg-warn-soft text-warn">演示中</span>}
                      </span>
                      <span className="block truncate text-[13px] text-ink-soft">
                        {p ? `${fmtDay(p.startDate)} 起 ${daysOf(p).length} 天 · ${p.travelerCount} 人 · ${p.activities.length} 站` : (t.draft.text || '尚未填写').slice(0, 30)}
                      </span>
                    </span>
                  </button>
                  <button className="px-4 text-ink-faint hover:text-danger" aria-label="删除行程" onClick={() => setConfirmDel(t.tripId)}><Icon name="trash" size={18} /></button>
                </li>
              );
            })}
          </ul>
          {rejected.length > 0 && <p className="mt-4 text-[12px] text-warn">有 {rejected.length} 份本地数据因版本不兼容未加载（未删除）。</p>}
          <p className="mt-4 text-center text-[12px] text-ink-faint">免登录 · 行程只保存在这台设备上</p>
        </section>
      )}

      <Modal open={demoInfo} onClose={() => setDemoInfo(false)} title="真实模式与演示模式">
        <div className="space-y-3 text-[14px] leading-relaxed text-ink-soft">
          <p><b className="text-ink">真实模式</b>：地点、路线、AI 规划都来自真实服务；旅行时使用你授权的定位，仅在页面前台工作。</p>
          <p><b className="text-ink">演示模式</b>：旅行模式下打开“演示控制台”，用<b className="text-brand">明确标注的模拟位置与场景</b>驱动同一套到达判定与 AI 服务。</p>
          <p>演示使用独立副本，退出即清除，不会写入真实旅行记录。</p>
        </div>
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(undefined)} title="删除这份行程？"
        footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setConfirmDel(undefined)}>取消</button>
          <button className="btn-danger flex-1" onClick={async () => { await removeTrip(confirmDel!); setConfirmDel(undefined); }}>删除</button></div>}>
        <p className="text-[14px] text-ink-soft">本机数据删除后无法恢复（没有云端备份）。</p>
      </Modal>
    </div>
  );
}
