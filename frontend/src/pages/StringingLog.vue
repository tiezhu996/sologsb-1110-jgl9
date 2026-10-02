<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ToneTextEditor from '../components/common/ToneTextEditor.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useStringingStore } from '../stores/stringingStore';
import { useBoardStore } from '../stores/boardStore';
import { useDraftStore } from '../stores/draftStore';
import { useFormDraft } from '../hooks/useFormDraft';
import { emptyStringingForm, stringingToForm } from '../utils/forms';
import { formatDate } from '../utils/layer';
import {
  NINE_VIRTUES,
  STRING_DEFECTS,
  STRING_TYPES,
  type StringDefect,
  type Stringing,
} from '../types/stringing';
import type { StringingDraftForm } from '../types/draft';
import type { ToneDraft } from '../types/stringing';

const route = useRoute();
const router = useRouter();
const stringingStore = useStringingStore();
const boardStore = useBoardStore();
const draftStore = useDraftStore();

const dialogVisible = ref(false);
const formRef = ref<FormInstance>();

const form = ref<StringingDraftForm>(emptyStringingForm());

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  operator: [{ required: true, message: '请输入上弦人', trigger: 'blur' }],
};

const draftSession = useFormDraft<StringingDraftForm>({
  kind: 'stringing',
  form,
  guqinNo: () => form.value.guqinNo,
  toPayload: (value) => ({ kind: 'stringing', form: value }),
  commit: (req) =>
    stringingStore.commitStringing({
      mode: req.mode,
      sessionId: req.sessionId,
      form: req.form,
      base: req.mode === 'edit' ? (req.base as Stringing) : null,
      resolutions: req.resolutions,
      expectedRev: req.expectedRev,
    }),
});
const { mode, conflict, submitting, restoredAt } = draftSession;
const conflictVisible = ref(false);

const stringTypeParam = computed(() => (typeof route.query.stringType === 'string' ? route.query.stringType : ''));
const defectParam = computed(() => (typeof route.query.defect === 'string' ? route.query.defect : ''));
const keyword = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));

const visible = computed(() =>
  stringingStore.search(keyword.value).filter((item) => {
    if (stringTypeParam.value && item.stringType !== stringTypeParam.value) return false;
    if (defectParam.value && !item.defects.includes(defectParam.value as StringDefect)) return false;
    return true;
  }),
);

const editingVersions = computed(() =>
  mode.value === 'edit' ? stringingStore.stringings.find((s) => s.id === draftSession.sessionId.value)?.noteVersions ?? [] : [],
);

const tone = computed<ToneDraft>({
  get: () => form.value.tone,
  set: (value) => {
    form.value.tone = value;
  },
});

function defaultTone(): ToneDraft {
  return {
    sanNote: '散音宽厚，一弦如钟。',
    anNote: '按音走手顺滑，无抗指。',
    fanNote: '泛音清亮，五六徽干净。',
    nineVirtues: `九德：${NINE_VIRTUES.join('、')}，以奇、古、透为先。`,
  };
}

function openCreate() {
  form.value = { ...emptyStringingForm(), guqinNo: boardStore.guqinNos[0] ?? 'Q-2506', tone: defaultTone() };
  const restored = draftSession.beginCreate();
  if (restored) form.value = restored;
  dialogVisible.value = true;
  ElMessage.info(restored ? '已恢复本页签上次未提交的上弦草稿' : '填写内容会自动存为本页签草稿，提交成功才进入正式档案');
}

function openEdit(stringing: Stringing) {
  form.value = stringingToForm(stringing);
  const restored = draftSession.beginEdit(stringing, stringing);
  if (restored) {
    form.value = restored;
    ElMessage.warning('已恢复本页签此前编辑该上弦档案的草稿，将按当前打开的版本核对提交');
  }
  dialogVisible.value = true;
}

async function resumeFromQuery() {
  const resumeId = typeof route.query.resumeDraft === 'string' ? route.query.resumeDraft : '';
  if (!resumeId || !resumeId.includes(':stringing:')) return;
  await draftStore.hydrate();
  const draft = await draftStore.get(resumeId);
  if (!draft || draft.kind !== 'stringing') return;
  form.value = draftSession.restore(draft);
  dialogVisible.value = true;
  ElMessage.info('已从草稿箱恢复草稿');
  void router.replace({ query: {} });
}

onMounted(() => {
  void resumeFromQuery();
});

watch(
  () => route.query.resumeDraft,
  () => {
    void resumeFromQuery();
  },
);

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const { ok: committed } = await draftSession.submitCommit();
  if (committed) {
    ElMessage.success(mode.value === 'edit' ? '已提交评语修改到正式档案，改动前文字已存入版本对照' : `已登记 ${form.value.guqinNo} 的上弦与音色评语`);
    dialogVisible.value = false;
    return;
  }
  conflictVisible.value = true;
  ElMessage.error('上弦正式档案已被其他页签改动，提交未写入；请在冲突核对中选择双方改动后重试');
}

async function retryWithResolutions(resolutions: Record<string, 'ours' | 'theirs'>) {
  const { ok: committed } = await draftSession.retryCommit(resolutions);
  if (committed) {
    conflictVisible.value = false;
    ElMessage.success('已按选择合并并提交到正式档案');
    dialogVisible.value = false;
  } else {
    ElMessage.error('核对期间正式档案又有更新，已重新列出双方改动，请再次选择后重试');
  }
}

async function handleCancel() {
  await draftSession.persistNow();
  dialogVisible.value = false;
}

async function discardDraft() {
  const confirmed = await ElMessageBox.confirm('丢弃当前草稿？该操作只删除本页签草稿，不影响正式档案。', '丢弃草稿', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await draftSession.discard();
  ElMessage.success('已丢弃草稿');
  dialogVisible.value = false;
}

async function remove(stringing: Stringing) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${stringing.guqinNo} 的上弦记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await stringingStore.removeStringing(stringing.id);
  ElMessage.success('已删除正式档案');
}
</script>

<template>
  <div>
    <h2 class="page-title">上弦记录与音色文字评价</h2>
    <p class="page-desc">散音 / 按音 / 泛音三段评语均为纯文本，保存后可检索关键字并对照历史版本；评语先存本页签草稿，提交时按版本核对，不做音频处理。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记上弦记录</el-button>
      <el-tag type="info" effect="plain">九德：{{ NINE_VIRTUES.join(' · ') }}</el-tag>
      <el-tag v-if="stringingStore.defectCount" type="warning" effect="plain">正式档案中有缺陷记录 {{ stringingStore.defectCount }} 条</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'stringType', label: '弦材质', options: STRING_TYPES, width: 110 },
        { key: 'defect', label: '缺陷', options: STRING_DEFECTS, width: 110 },
      ]"
      keyword-placeholder="检索散音 / 按音 / 泛音 / 九德文字"
      :result-count="visible.length"
      :total-count="stringingStore.stringings.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的上弦正式档案" action-text="登记上弦记录" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border>
        <el-table-column prop="guqinNo" label="琴号" width="100" />
        <el-table-column prop="stringType" label="弦材质" width="90" />
        <el-table-column prop="nut" label="雁足与绒扣" width="170" />
        <el-table-column prop="stringGap" label="弦距(mm)" width="90" />
        <el-table-column label="散音" min-width="160" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.sanNote }}</template>
        </el-table-column>
        <el-table-column label="按音" min-width="160" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.anNote }}</template>
        </el-table-column>
        <el-table-column label="泛音" min-width="150" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.fanNote }}</template>
        </el-table-column>
        <el-table-column label="九德简述" min-width="170" show-overflow-tooltip>
          <template #default="scope">{{ scope.row.nineVirtues }}</template>
        </el-table-column>
        <el-table-column label="缺陷" width="140">
          <template #default="scope">
            <el-tag v-for="defect in scope.row.defects" :key="defect" :type="defect === '无' ? 'success' : 'danger'" size="small" class="defect-tag">
              {{ defect }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="上弦日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.strungAt) }}</template>
        </el-table-column>
        <el-table-column prop="operator" label="上弦人" width="90" />
        <el-table-column label="版本" width="80">
          <template #default="scope">评语 {{ scope.row.noteVersions.length }} · 档案 v{{ scope.row.rev }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEdit(scope.row)">编辑评语</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="mode === 'edit' ? '编辑上弦记录与评语（草稿）' : '登记上弦记录（草稿）'" width="820px" :close-on-click-modal="false">
      <el-alert
        v-if="restoredAt"
        :title="`恢复自本页签暂存的草稿（${formatDate(restoredAt)}）`"
        type="info"
        :closable="false"
        show-icon
        class="draft-tip"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2506" maxlength="20" style="width: 200px" />
        </el-form-item>
        <el-form-item label="弦材质">
          <el-select v-model="form.stringType" style="width: 160px">
            <el-option v-for="type in STRING_TYPES" :key="type" :label="type" :value="type" />
          </el-select>
        </el-form-item>
        <el-form-item label="雁足与绒扣">
          <el-input v-model="form.nut" placeholder="如：红木雁足 + 丝绒扣" maxlength="40" style="width: 300px" />
        </el-form-item>
        <el-form-item label="弦距(mm)">
          <el-input-number v-model="form.stringGap" :min="10" :max="30" :step="0.5" :precision="1" placeholder="弦距" />
        </el-form-item>
        <el-form-item label="缺陷标记">
          <el-checkbox-group v-model="form.defects">
            <el-checkbox v-for="defect in STRING_DEFECTS" :key="defect" :label="defect" :value="defect">{{ defect }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="上弦日期">
          <el-date-picker v-model="form.strungAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="上弦人" prop="operator">
          <el-input v-model="form.operator" placeholder="如：周砚秋" maxlength="16" style="width: 200px" />
        </el-form-item>
      </el-form>

      <ToneTextEditor v-model="tone" :versions="editingVersions" />

      <template #footer>
        <div class="dialog-footer">
          <el-button text type="danger" @click="discardDraft">丢弃草稿</el-button>
          <div>
            <el-button @click="handleCancel">取消（保留草稿）</el-button>
            <el-button type="primary" :loading="submitting" @click="submit">提交到正式档案</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <ConflictDialog
      v-model="conflictVisible"
      :conflict="conflict"
      kind-label="上弦"
      @retry="retryWithResolutions"
      @cancel="conflictVisible = false"
    />
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 12px;
  color: #8a7a68;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.defect-tag {
  margin-right: 4px;
}
.draft-tip {
  margin-bottom: 10px;
}
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
