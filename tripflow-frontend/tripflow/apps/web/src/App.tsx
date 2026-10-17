import { useEffect, type ReactNode } from 'react';
import { useTrips } from './store/tripStore';
import { api, describeError } from './api/client';
import { Toaster, Spinner } from './components/ui';
import { Icon } from './components/Icon';

export function App({ children }: { children: ReactNode }) {
  const loaded = useTrips((s) => s.loaded);
  const load = useTrips((s) => s.load);
  const setCaps = useTrips((s) => s.setCapabilities);
  const saveError = useTrips((s) => s.saveError);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // I13：读取真实能力/降级状态与运行限值；失败不影响查看本地行程
    const ctrl = new AbortController();
    api.capabilities(ctrl.signal)
      .then((r) => setCaps(r.data ?? undefined))
      .catch((e) => setCaps(undefined, describeError(e).title));
    return () => ctrl.abort();
  }, [setCaps]);

  return (
    <div className="mx-auto h-full max-w-[560px] overflow-hidden bg-paper sm:border-x sm:border-sand">
      {saveError && (
        <div role="alert" className="fixed inset-x-0 top-0 z-[90] mx-auto flex max-w-[560px] items-start gap-2 bg-danger px-4 py-2.5 text-[13px] text-white">
          <Icon name="alert" size={16} className="mt-0.5" /> <span className="flex-1">{saveError} 请先备份重要内容。</span>
        </div>
      )}
      {loaded ? children : <div className="flex h-full items-center justify-center text-ink-soft"><Spinner /></div>}
      <Toaster />
    </div>
  );
}
