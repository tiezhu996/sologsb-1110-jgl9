<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { WarningFilled } from '@element-plus/icons-vue';
import { formatConflictValue } from '../../utils/concurrency';
import type { CommitContext } from '../../hooks/useDraftEditor';

const props = defineProps<{
  context: CommitContext | null;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'resolve', resolved: Record<string, 'mine' | 'theirs'>): void;
  (e: 'cancel'): void;
}>();

/** 每个冲突字段选择保留哪一方，默认保留本页签草稿 */
const choice = reactive<Record<string, 'mine' | 'theirs'>>({});

watch(
  () => props.context,
  (context) => {
    for (const key of Object.keys(choice)) delete choice[key];
    context?.check.conflicts.forEach((c) => {
      choice[c.field] = 'mine';
    });
  },
  { immediate: true },
);

const visible = computed({
  get: () => props.context !== null,
  set: (value) => {
    if (!value) emit('cancel');
  },
});

const title = computed(() =>
  props.context?.check.missing ? '正式档案已被另一页签删除' : '检测到同张琴的并发改动',
);

function confirm() {
  emit('resolve', { ...choice });
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="860px"
    :close-on-click-modal="false"
    append-to-body
    class="conflict-dialog"
  >
    <el-alert
      v-if="context && !context.check.missing"
      type="warning"
      :closable="false"
      show-icon
      :icon="WarningFilled"
      class="conflict-alert"
      title="提交时按本页打开时的版本核对，发现另一页签已先提交，且双方改了同一字段。"
      description="原正式档案未改动、本草稿已保留。请逐字段选择保留哪一方的改动后重试；未列出的字段已自动合入对方改动。"
    />
    <el-alert
      v-else
      type="error"
      :closable="false"
      show-icon
      class="conflict-alert"
      title="本页打开编辑后，该记录已被另一页签删除。"
      description="为避免覆盖对方的删除操作，本次提交已中止，正式档案保持已删除状态，草稿仍保留。选择字段后可重建该记录，或放弃草稿。"
    />

    <el-table v-if="context" :data="context.check.conflicts" size="small" border class="conflict-table">
      <el-table-column :label=" '字段' " width="110">
        <template #default="scope">
          <strong>{{ context.labels[scope.row.field] ?? scope.row.field }}</strong>
        </template>
      </el-table-column>
      <el-table-column label="打开时（初版依据）" min-width="180">
        <template #default="scope">
          <span class="val-base">{{ formatConflictValue(scope.row.base) }}</span>
        </template>
      </el-table-column>
      <el-table-column min-width="200">
        <template #header>
          <span class="col-theirs">对方页签已提交{{ context.check.missing ? '（已删除）' : '' }}</span>
        </template>
        <template #default="scope">
          <el-radio v-model="choice[scope.row.field]" value="theirs" class="cell-radio">
            <span class="val-theirs">{{ context.check.missing ? '（档案已删除）' : formatConflictValue(scope.row.theirs) }}</span>
          </el-radio>
        </template>
      </el-table-column>
      <el-table-column label="本页签草稿" min-width="200">
        <template #default="scope">
          <el-radio v-model="choice[scope.row.field]" value="mine" class="cell-radio">
            <span class="val-mine">{{ formatConflictValue(scope.row.mine) }}</span>
          </el-radio>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="emit('cancel')">稍后处理（保留草稿）</el-button>
      <el-button :loading="submitting" @click="confirm">
        {{ context?.check.missing ? '按所选内容重建并提交' : '按所选内容合并提交' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.conflict-alert {
  margin-bottom: 12px;
}
.conflict-table {
  margin-bottom: 4px;
}
.col-theirs {
  color: #c62828;
}
.cell-radio {
  height: auto;
  align-items: flex-start;
  white-space: normal;
}
.val-base {
  color: #909399;
}
.val-theirs {
  color: #c62828;
}
.val-mine {
  color: #1f6f43;
}
</style>
