import { useState } from 'react';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { useTrips, activeWs } from '../store/tripStore';
import { Icon } from '../components/Icon';
import { Modal, toast } from '../components/ui';
import { AGENT_NAME } from '../components/AgentProgress';
import { INTERIM_GEO_POLICY } from '@tripflow/context-engine';
import { UNDO_LIMIT } from '../store/types';

/** P11 偏好与提醒设置。设置变更递增 revision，但不进入撤销栈。 */
export function SettingsPage() {
  const { tripId = '' } = useParams();
  const nav = useNavigate();
  const trip = useTrips((s) => s.trips[tripId]);
  const settings = useTrips((s) => s.settings);
  const stopDemo = useTrips((s) => s.stopDemo);
  const removeTrip = useTrips((s) => s.removeTrip);
  const clearAll = useTrips((s) => s.clearAll);
  const caps = useTrips((s) => s.capabilities);
  const capErr = useTrips((s) => s.capabilityError);
  const [ask, setAsk] = useState<'trip' | 'all'>();
  const [showGeo, setShowGeo] = useState(false);
  const ws = activeWs(trip);
  if (!trip) return <Navigate to="/" replace />;
  const plan = ws?.plan;
  const pol = plan?.notificationPolicy;
  const setPol = (patch: Partial<NonNullable<typeof pol>>) => pol && settings(tripId, { notificationPolicy: { ...pol, ...patch } }).catch(() => undefined);
  const geo = caps?.geoPolicy ?? INTERIM_GEO_POLICY;

  const Sw = ({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; disabled?: boolean }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => set(!on)}
      className={`relative h-[30px] w-[50px] shrink-0 rounded-full transition disabled:opacity-40 ${on ? 'bg-brand' : 'bg-[#E3E7ED]'}`}>
      <span className={`absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'left-[23px]' : 'left-[3px]'}`} />
    </button>
  );
  const Item = ({ title, hint, right, onClick, danger }: { title: string; hint?: string; right?: React.ReactNode; onClick?: () => void; danger?: boolean }) => {
    const body = (
      <>
        <span className="min-w-0 flex-1 text-left">
          <span className={`block text-[15px] ${danger ? 'text-danger' : ''}`}>{title}</span>
          {hint && <span className="block text-[12px] text-ink-faint">{hint}</span>}
        </span>
        {right ?? (onClick && <Icon name="chevron" size={16} className="text-ink-faint" />)}
      </>
    );
    return onClick
      ? <button className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5" onClick={onClick}>{body}</button>
      : <div className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">{body}</div>;
  };
  const Group = ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section>
      {title && <h2 className="mb-1.5 px-1 text-[13px] font-semibold text-ink-soft">{title}</h2>}
      <div className="divide-y divide-sand/80 overflow-hidden rounded-[16px] bg-white">{children}</div>
    </section>
  );
  const [geoInfo, setGeoInfo] = [showGeo, setShowGeo];

  return (
    <div className="flex h-full flex-col bg-paper">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-[calc(14px+var(--safe-t))]">
        <button className="absolute left-3 flex h-10 w-10 items-center justify-center" onClick={() => nav(-1)} aria-label="返回"><Icon name="back" /></button>
        <h1 className="text-[17px] font-semibold">设置</h1>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-10">
        {trip.demo && <p className="rounded-[12px] bg-warn-soft p-3 text-[13px] text-warn">当前处于演示运行，以下提醒设置作用于演示副本。</p>}
        {pol && (
          <Group title="推送提醒">
            <Item title="顺路知识（L1）" hint="到达时的轻提示，每次到达最多一条" right={<Sw label="顺路知识" on={pol.enableL1} disabled={pol.paused} set={(v) => setPol({ enableL1: v })} />} />
            <Item title="任务提醒（L2）" hint="到达任务地点时提醒并准备内容" right={<Sw label="任务提醒" on={pol.enableL2} disabled={pol.paused} set={(v) => setPol({ enableL2: v })} />} />
            <Item title="风险提醒（L3）" hint="有可信证据时提醒，不自动改行程" right={<Sw label="风险提醒" on={pol.enableL3} set={(v) => setPol({ enableL3: v })} />} />
            <Item title="暂停普通提醒" hint="暂停 L1/L2，风险提醒单独控制" right={<Sw label="暂停普通提醒" on={pol.paused} set={(v) => setPol({ paused: v })} />} />
            <Item title="提醒间隔" right={
              <select className="rounded-full bg-[#F3F5F8] px-3 py-1.5 text-[14px]" value={pol.cooldownMinutes} onChange={(e) => setPol({ cooldownMinutes: Number(e.target.value) })} aria-label="提醒间隔">
                {[5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} 分钟</option>)}
              </select>} />
          </Group>
        )}
        <Group title="位置">
          <Item title="位置权限" hint="仅在旅行模式、页面前台时使用" onClick={() => setGeoInfo(!geoInfo)}
            right={<span className="flex items-center gap-1 text-[13px] text-brand">{plan?.mode === 'TRAVELING' ? '旅行中' : '未使用'}<Icon name="chevron" size={16} className="text-ink-faint" /></span>} />
          {geoInfo && (
            <div className="space-y-1.5 px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
              <p>只有你开启旅行模式并授权后才会使用定位；后台/锁屏时暂停，回到前台重新测量，不推测缺失区间。到达判断在本机完成，不上传连续轨迹。</p>
              <p className="text-ink-faint">判定参数（{geo.policyVersion}{caps ? '，来自服务端' : '，前端临时值'}）：到达 {geo.arrivalRadiusMeters}m / 离开 {geo.departureRadiusMeters}m / 精度上限 {geo.maxAccuracyMeters}m / 驻留 {geo.arrivalDwellSeconds}s / 离开 {geo.departureDwellSeconds}s</p>
            </div>
          )}
        </Group>
        <Group title="服务状态">
          {!caps && <Item title="规划服务" hint={capErr ?? '正在读取…'} />}
          {caps?.tools.map((t) => <Item key={t.name} title={t.name} hint={t.reason} right={<span className={`h-2 w-2 rounded-full ${t.available ? 'bg-ok' : 'bg-danger'}`} />} />)}
          {caps?.modelRoutes.map((m) => <Item key={m.agentId} title={`${AGENT_NAME[m.agentId]} Agent`} hint={`${m.provider} / ${m.model}`} right={!m.available ? <span className="text-[12px] text-danger">不可用</span> : undefined} />)}
        </Group>
        <Group title="数据">
          {trip.demo && <Item title="清除演示/模拟记录" onClick={async () => { await stopDemo(tripId); toast('模拟记录已清除'); }} />}
          <Item title="删除这份行程" danger onClick={() => setAsk('trip')} />
          <Item title="清除本地数据" hint={`删除本机全部行程、记录和模拟数据 · 撤销最多保留 ${UNDO_LIMIT} 步`} danger onClick={() => setAsk('all')} />
        </Group>
        <Group>
          <Item title="关于 TripFlow" hint="免登录，行程只保存在这台设备上，没有云端备份" />
        </Group>
      </div>
      <Modal open={!!ask} onClose={() => setAsk(undefined)} title={ask === 'all' ? '清除全部本地数据？' : '删除这份行程？'}
        footer={<div className="flex gap-2"><button className="btn-ghost flex-1" onClick={() => setAsk(undefined)}>取消</button>
          <button className="btn-danger flex-1" onClick={async () => { if (ask === 'all') await clearAll(); else await removeTrip(tripId); nav('/', { replace: true }); }}>确认删除</button></div>}>
        <p className="text-[14px] text-ink-soft">删除后无法恢复。</p>
      </Modal>
    </div>
  );
}
