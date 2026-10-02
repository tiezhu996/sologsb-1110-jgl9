import { onMounted, onUnmounted } from 'vue';
import { createBus, type BusMessage } from '../utils/bus';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';

/**
 * 监听其他页签的正式档案提交：收到广播后重新从 IndexedDB 装载四张正式表。
 * 这样另一个页签补录提交后，本页签的首页进度 / 导出 / 异常统计 / 台账都以最新正式档案为准；
 * 本页签正在填写的草稿不受影响（草稿只存 drafts 表）。
 */
export function useArchiveSync() {
  let channel: BroadcastChannel | null = null;
  let reloading = false;

  async function reloadArchives() {
    if (reloading) return;
    reloading = true;
    try {
      await Promise.all([
        useBoardStore().hydrate(),
        useChamberStore().hydrate(),
        useLacquerStore().hydrate(),
        useStringingStore().hydrate(),
      ]);
    } finally {
      reloading = false;
    }
  }

  onMounted(() => {
    channel = createBus();
    if (!channel) return;
    channel.addEventListener('message', (event) => {
      const msg = event.data as BusMessage;
      if (msg.type === 'archive-committed') {
        void reloadArchives();
      }
    });
  });

  onUnmounted(() => {
    channel?.close();
    channel = null;
  });

  return { reloadArchives };
}
