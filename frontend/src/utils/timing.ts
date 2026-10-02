/** 简单防抖：编辑表单自动保存草稿时避免每次按键都写 IndexedDB */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** 取消尚未触发的一次调用 */
  cancel: () => void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait = 400): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}
