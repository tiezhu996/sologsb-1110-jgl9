/**
 * 页签实例标识：同机两个页签同时编辑时，用 sessionStorage 区分页签。
 *
 * sessionStorage 按页签隔离：新开页签拿到的是空存储，各自生成随机号即可；
 * 但“复制页签”会把旧页签的 storage 原样拷走，两个页签会撞号。
 * 因此启动时通过 BroadcastChannel 做一次认领握手：若仍有存活的页签持有同号，
 * 新页签重新取号，直到号唯一。正常刷新时旧上下文已随卸载关闭，不会有人应答，
 * 页签号保持不变（未提交的草稿仍认得上一轮编辑）。
 */

const TAB_KEY = 'gbguqin-tab-id';
const CHANNEL = 'gbguqin-tab-registry';
const HANDSHAKE_MS = 220;

let current = '';
let ready: Promise<string> | null = null;

function generate(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function claimOnce(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL);
    const nonce = `${candidate}:${Math.random().toString(36).slice(2)}`;
    let collided = false;
    const timer = setTimeout(() => {
      channel.close();
      resolve(!collided);
    }, HANDSHAKE_MS);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; nonce?: string } | undefined;
      if (data?.type === 'claim' && data.id === candidate && data.nonce !== nonce) {
        // 有别的存活页签也持有这个号 → 回应对方
        channel.postMessage({ type: 'taken', id: candidate, nonce: data.nonce });
      } else if (data?.type === 'taken' && data.nonce === nonce) {
        collided = true;
        clearTimeout(timer);
        channel.close();
        resolve(false);
      }
    };
    channel.postMessage({ type: 'claim', id: candidate, nonce });
  });
}

/** 应用启动时调用一次：完成页签号认领并写入 sessionStorage */
export async function initTabId(): Promise<string> {
  if (!ready) {
    ready = (async () => {
      let candidate = sessionStorage.getItem(TAB_KEY) || generate();
      // 极端情况下复制出多个页签，最多重试若干轮
      for (let i = 0; i < 5; i++) {
        const unique = await claimOnce(candidate);
        if (unique) break;
        candidate = generate();
      }
      current = candidate;
      sessionStorage.setItem(TAB_KEY, current);
      // 继续保留通道：后续复制出的页签握手时本页签要应答
      listen();
      return current;
    })();
  }
  return ready;
}

/** 常驻监听：应答后启动页签的认领请求 */
function listen(): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: string; nonce?: string } | undefined;
    if (data?.type === 'claim' && data.id === current) {
      channel.postMessage({ type: 'taken', id: current, nonce: data.nonce });
    }
  };
}

/** 返回当前页签号（initTabId 完成后可用） */
export function getTabId(): string {
  if (!current) {
    throw new Error('页签标识尚未初始化，请先 await initTabId()');
  }
  return current;
}
