<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Document } from '@element-plus/icons-vue';
import { useDraftStore } from '../../stores/draftStore';
import { DRAFT_KIND_LABELS, type ProcessDraft } from '../../types/draft';
import { formatDate } from '../../utils/layer';

const emit = defineEmits<{ (e: 'open', draft: ProcessDraft): void }>();

const draftStore = useDraftStore();
const router = useRouter();
const drafts = computed(() => draftStore.tabDrafts);

const ROUTES: Record<ProcessDraft['kind'], string> = {
  board: '/boards',
  chamber: '/chambers',
  lacquer: '/lacquer',
  stringing: '/stringing',
};

function openDraft(draft: ProcessDraft) {
  void router.push({
    path: ROUTES[draft.kind],
    query: { resumeDraft: draft.id },
  });
  emit('open', draft);
}

async function dropDraft(draft: ProcessDraft, event: Event) {
  event.stopPropagation();
  await draftStore.remove(draft.id);
}
</script>

<template>
  <el-popover placement="bottom-end" :width="380" trigger="click">
    <template #reference>
      <el-button :icon="Document">
        本页签草稿
        <el-badge v-if="drafts.length" :value="drafts.length" class="draft-badge" type="warning" />
      </el-button>
    </template>

    <div class="inbox-head">
      <span>本页签未提交的工序草稿</span>
      <span class="inbox-count">{{ drafts.length }} 条</span>
    </div>
    <el-empty v-if="drafts.length === 0" :image-size="56" description="没有草稿；弹窗里填写的内容会自动暂存" />
    <div v-else class="inbox-list">
      <div v-for="draft in drafts" :key="draft.id" class="inbox-item" @click="openDraft(draft)">
        <div class="item-main">
          <el-tag size="small" :type="draft.mode === 'edit' ? 'warning' : 'success'" effect="plain">
            {{ draft.mode === 'edit' ? '编辑' : '新增' }}·{{ DRAFT_KIND_LABELS[draft.kind] }}
          </el-tag>
          <span class="item-no">{{ draft.guqinNo || '（未填琴号）' }}</span>
        </div>
        <div class="item-foot">
          <span>暂存于 {{ formatDate(draft.updatedAt) }} {{ new Date(draft.updatedAt).toTimeString().slice(0, 5) }}</span>
          <el-button link type="danger" size="small" @click="dropDraft(draft, $event)">丢弃</el-button>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.draft-badge {
  margin-left: 6px;
}
.inbox-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: #4a3728;
  margin-bottom: 8px;
}
.inbox-count {
  font-weight: 400;
  color: #8a7a68;
}
.inbox-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 360px;
  overflow-y: auto;
}
.inbox-item {
  border: 1px solid #ece0cf;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  background: #fdfaf5;
}
.inbox-item:hover {
  border-color: #c8a97a;
}
.item-main {
  display: flex;
  align-items: center;
  gap: 8px;
}
.item-no {
  font-weight: 600;
  color: #4a3728;
}
.item-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-size: 12px;
  color: #8a7a68;
}
</style>
