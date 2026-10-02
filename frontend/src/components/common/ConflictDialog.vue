<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { formatFieldValue } from '../../utils/forms';
import type { CommitConflict, FieldConflict } from '../../utils/conflict';

const props = defineProps<{
  modelValue: boolean;
  conflict: CommitConflict | null;
  /** 所属工序（弹窗标题用） */
  kindLabel: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  /** 档案员逐项选择后重试；resolutions 按字段给出采用方 */
  (e: 'retry', resolutions: Record<string, 'ours' | 'theirs'>): void;
  (e: 'cancel'): void;
}>();

const rows = ref<FieldConflict[]>([]);

watch(
  () => props.conflict,
  (conflict) => {
    rows.value = conflict ? conflict.fields.map((f) => ({ ...f, resolution: 'ours' })) : [];
  },
  { immediate: true },
);

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const isRecordIssue = computed(() => props.conflict?.issue !== 'fields');

function chooseAll(side: 'ours' | 'theirs') {
  rows.value.forEach((row) => {
    row.resolution = side;
  });
}

function confirmRetry() {
  const resolutions: Record<string, 'ours' | 'theirs'> = {};
  rows.value.forEach((row) => {
    resolutions[row.key] = row.resolution;
  });
  emit('retry', resolutions);
}

function cancel() {
  emit('cancel');
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="`提交冲突核对 · ${kindLabel}`"
    width="860px"
    :close-on-click-modal="false"
  >
    <el-alert
      v-if="isRecordIssue"
      :title="conflict?.message ?? '正式档案已发生变化'"
      type="error"
      :closable="false"
      show-icon
      class="issue-alert"
    >
      <template #default>
        <div>该草稿与正式档案均已保留，请关闭弹窗核对台账后调整草稿，再重新提交。</div>
      </template>
    </el-alert>

    <template v-else>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="issue-alert"
        title="另一个页签已经提交了同一记录，以下字段双方都做了修改"
        description="请逐项核对「对方已保存」与「本页签草稿」后选择采用哪一方；未列字段互不冲突，会自动合并。选择后可重试提交。"
      />
      <div class="bulk-actions">
        <span>批量选择：</span>
        <el-button size="small" @click="chooseAll('ours')">全部采用本页签草稿</el-button>
        <el-button size="small" @click="chooseAll('theirs')">全部采用对方已保存</el-button>
      </div>
      <el-table :data="rows" size="small" border class="conflict-table">
        <el-table-column prop="label" label="字段" width="110" />
        <el-table-column label="打开时值" min-width="150">
          <template #default="scope">
            <span class="base-value">{{ formatFieldValue(scope.row.key, scope.row.base) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="对方页签已保存" min-width="170">
          <template #default="scope">
            <span class="theirs-value">{{ formatFieldValue(scope.row.key, scope.row.theirs) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="本页签草稿" min-width="170">
          <template #default="scope">
            <span class="ours-value">{{ formatFieldValue(scope.row.key, scope.row.ours) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="采用" width="210" align="center">
          <template #default="scope">
            <el-radio-group v-model="scope.row.resolution" size="small">
              <el-radio value="theirs">对方</el-radio>
              <el-radio value="ours">本页签</el-radio>
            </el-radio-group>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template #footer>
      <el-button @click="cancel">{{ isRecordIssue ? '返回修改' : '保留草稿，稍后再试' }}</el-button>
      <el-button v-if="!isRecordIssue" type="primary" @click="confirmRetry">
        按选择合并并重试提交
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.issue-alert {
  margin-bottom: 12px;
}
.bulk-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 13px;
  color: #6b5b4b;
}
.conflict-table :deep(.theirs-value) {
  color: #b88230;
}
.conflict-table :deep(.ours-value) {
  color: #4a3728;
  font-weight: 600;
}
.conflict-table :deep(.base-value) {
  color: #a3968a;
  text-decoration: line-through;
}
</style>
