import { createBus, type BusMessage } from './bus';

const TAB_ID_KEY = 'gbguqin-tab-id';

function makeTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let tabId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(TAB_ID_KEY) ?? '' : '';
/** 常驻通道：已打开的页签在整个生命周期内应答后开页签的握手 */
let channel: BroadcastChannel | null = null;

/** 当前页签标识（同页签刷新保留） */
export function getTabId(): string {
  if (!tabId) {
    tabId = makeTabId();
    sessionStorage.setItem(TAB_ID_KEY, tabId);
  }
  return tabId;
}

/**
 * 页签身份握手，应在挂载应用前 await，且通道常驻：
 * - 单独刷新：没有其他同 id 页签应答，保留原 id，草稿可继续编辑；
 * - 「重复页签」会复制 sessionStorage 得到相同 id，已打开的原页签常驻应答 nudge，
 *   后开者更换新 id，于是两个页签的工序草稿各自独立保存；
 * - 多个页签同时刷新时可能同时更换，随机 id 互不重复，结果仍是各自独立。
 */
export function ensureTabId(timeoutMs = 250): Promise<string> {
  return new Promise((resolve) => {
    const currentId = getTabId();
    channel ??= createBus();
    if (!channel) {
      resolve(currentId);
      return;
    }

    // 常驻监听：发现与本页签同 id 的后来者，应答让其更换
    channel.addEventListener('message', (event) => {
      const msg = event.data as BusMessage;
      if (msg.type === 'hello' && msg.id === getTabId()) {
        channel?.postMessage({ type: 'nudge', id: getTabId(), to: msg.nonce });
      }
    });

    const nonce = Math.random().toString(36).slice(2);
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tabId = value;
      sessionStorage.setItem(TAB_ID_KEY, value);
      resolve(value);
    };
    const timer = setTimeout(() => finish(currentId), timeoutMs);

    // 启动窗口内收到指向本页签 nonce 的应答：更换为新 id（通道保持常驻）
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as BusMessage;
      if (msg.type === 'nudge' && msg.id === currentId && msg.to === nonce) {
        channel?.removeEventListener('message', onMessage);
        finish(makeTabId());
      }
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'hello', id: currentId, nonce });
  });
}
