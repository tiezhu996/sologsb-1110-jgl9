<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download, Document } from '@element-plus/icons-vue';
import { initTabId } from './utils/tab';
import { seedIfEmpty } from './utils/seed';
import { downloadText, exportBackupJson } from './utils/export';
import { useBoardStore } from './stores/boardStore';
import { useChamberStore } from './stores/chamberStore';
import { useLacquerStore } from './stores/lacquerStore';
import { useStringingStore } from './stores/stringingStore';
import { useDraftStore } from './stores/draftStore';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const draftStore = useDraftStore();
const ready = ref(false);

/** 仅统计本页签未提交草稿（正式档案的异常/进度不含草稿） */
const pendingDrafts = computed(() => draftStore.pendingCount);

onMounted(async () => {
  try {
    // 先认领页签号：草稿按页签隔离，必须早于草稿读写
    await initTabId();
    await seedIfEmpty();
    const subs = [
      boardStore.hydrate(),
      chamberStore.hydrate(),
      lacquerStore.hydrate(),
      stringingStore.hydrate(),
    ];
    await draftStore.hydrate();
    await Promise.all(subs.map((sub) => sub.ready));
  } catch (error) {
    ElMessage.error(`本地数据装载失败：${(error as Error).message}`);
  } finally {
    ready.value = true;
  }
});

async function handleExport() {
  const json = await exportBackupJson();
  downloadText(`gbguqin-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
  ElMessage.success('已导出正式工序档案 JSON 备份（不含页签草稿）');
}
</script>

<template>
  <el-container class="app-shell">
    <el-aside width="208px" class="app-aside">
      <div class="brand">
        <div class="brand-title">古琴斫制工序记录台</div>
        <div class="brand-sub">gbguqin · 纯前端本地存储</div>
      </div>
      <el-menu :default-active="route.path" router class="app-menu" background-color="#4a3728" text-color="#f0e6d8" active-text-color="#ffd591">
        <el-menu-item index="/">琴坯进度</el-menu-item>
        <el-menu-item index="/boards">板材登记</el-menu-item>
        <el-menu-item index="/chambers">槽腹尺寸</el-menu-item>
        <el-menu-item index="/lacquer">灰胎髹漆</el-menu-item>
        <el-menu-item index="/stringing">上弦评价</el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="app-header">
        <span class="header-title">{{ (route.meta?.title as string) ?? '古琴斫制工序记录台' }}</span>
        <div class="header-actions">
          <el-tooltip
            v-if="pendingDrafts"
            placement="bottom"
            content="本页签有尚未提交的工序草稿，正式档案未受影响；可回到对应页面继续编辑并提交"
          >
            <el-tag type="warning" effect="plain" :icon="Document" class="draft-badge">
              本页草稿 {{ pendingDrafts }} 条待提交
            </el-tag>
          </el-tooltip>
          <el-button :icon="Download" @click="handleExport">导出备份</el-button>
        </div>
      </el-header>
      <el-main v-loading="!ready" element-loading-text="正在装载本地工序档案…" class="app-main">
        <router-view />
      </el-main>
      <el-footer class="app-footer">正式工序档案保存在浏览器 IndexedDB（gbguqin-db），草稿按页签单独存放，不依赖后端服务</el-footer>
    </el-container>
  </el-container>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}
.app-aside {
  background: #4a3728;
  color: #f0e6d8;
}
.brand {
  padding: 16px 16px 8px;
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
}
.brand-sub {
  font-size: 12px;
  color: #cbb79f;
}
.app-menu {
  border-right: none;
}
.app-header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #ece0cf;
}
.header-title {
  font-weight: 600;
  color: #4a3728;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.draft-badge {
  cursor: default;
}
.app-main {
  background: #f7f3ed;
  min-height: 60vh;
}
.app-footer {
  text-align: center;
  color: #a3968a;
  font-size: 12px;
  line-height: 48px;
}
</style>
