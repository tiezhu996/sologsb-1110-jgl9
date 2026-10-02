/**
 * 同源页签间通信：
 * - hello/nudge：页签身份握手（重复页签会复制 sessionStorage，需要后开者换 id）
 * - archive-committed：某页签正式工序档案提交成功，其他页签据此重新装载正式档案
 */
export interface BusHello {
  type: 'hello';
  id: string;
  nonce: string;
}
export interface BusNudge {
  type: 'nudge';
  id: string;
  to: string;
}
export interface BusArchiveCommitted {
  type: 'archive-committed';
  at: string;
}
export type BusMessage = BusHello | BusNudge | BusArchiveCommitted;

const CHANNEL_NAME = 'gbguqin-bus';

let shared: BroadcastChannel | null = null;

/** 获取进程内单例通信通道（tab 握手常驻监听、提交广播都复用，避免即开即关丢消息） */
export function createBus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!shared) {
    shared = new BroadcastChannel(CHANNEL_NAME);
  }
  return shared;
}

/** 经单例通道广播一条消息 */
export function postBus(message: BusMessage): void {
  createBus()?.postMessage(message);
}
