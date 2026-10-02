import { liveQuery, type Subscription } from 'dexie';

/**
 * 用 Dexie liveQuery 订阅正式档案表：本页签提交会即时回显，
 * 同机另一个页签提交后本页签也能收到最新正式档案（草稿不在订阅范围内）。
 */
export function subscribeTable<T>(
  querier: () => Promise<T[]>,
  onNext: (rows: T[]) => void,
): { ready: Promise<void>; stop: () => void } {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let settled = false;
  let subscription: Subscription | undefined;
  subscription = liveQuery(querier).subscribe({
    next: (rows) => {
      onNext(rows);
      if (!settled) {
        settled = true;
        resolveReady();
      }
    },
    error: () => {
      if (!settled) {
        settled = true;
        resolveReady();
      }
    },
  });
  return {
    ready,
    stop: () => subscription?.unsubscribe(),
  };
}
