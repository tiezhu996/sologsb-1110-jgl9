<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ToneTextEditor from '../components/common/ToneTextEditor.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useStringingStore, newStringingDraftId } from '../stores/stringingStore';
import { useBoardStore } from '../stores/boardStore';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { formatDate } from '../utils/layer';
import { RECORD_FIELDS } from '../utils/records';
import type { DraftPayload, ProcessDraft } from '../types/draft';
import {
  NINE_VIRTUES,
  STRING_DEFECTS,
  STRING_TYPES,
  type StringDefect,
  type StringType,
  type Stringing,
  type ToneDraft,
} from '../types/stringing';

const route = useRoute();
const stringingStore = useStringingStore();
const boardStore = useBoardStore();

const formRef = ref<FormInstance>();

interface StringingForm {
  guqinNo: string;
  stringType: StringType;
  nut: string;
  stringGap: number;
  defects: StringDefect[];
  strungAt: string;
  operator: string;
}

const emptyForm = (guqinNo: string): StringingForm => ({
  guqinNo,
  stringType: '丝弦',
  nut: '红木雁足 + 丝绒扣',
  stringGap: 17,
  defects: ['无'],
  strungAt: new Date().toISOString().slice(0, 10),
  operator: '周砚秋',
});

const defaultTone = (): ToneDraft => ({
  sanNote: '散音宽厚，一弦如钟。',
  anNote: '按音走手顺滑，无抗指。',
  fanNote: '泛音清亮，五六徽干净。',
  nineVirtues: `九德：${NINE_VIRTUES.join('、')}，以奇、古、透为先。`,
});

const form = ref<StringingForm>(emptyForm('Q-2506'));
const tone = ref<ToneDraft>({ sanNote: '', anNote: '', fanNote: '', nineVirtues: '' });
const armed = ref(false);

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  operator: [{ required: true, message: '请输入上弦人', trigger: 'blur' }],
};

const editor = useDraftEditor({
  kind: 'stringing',
  getRecord: (id) => stringingStore.stringings.find((s) => s.id === id),
});
const { dialogVisible, existed, commitContext, submitting, pendingDrafts } = editor;

const labels = Object.fromEntries(RECORD_FIELDS.stringing.map((f) => [f.key, f.label]));

watch(
  [form, tone],
  () => {
    if (armed.value) editor.persist(toPayload());
  },
  { deep: true },
);

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

/** 版本对照只列正式档案的历史版本（草稿不产生历史版本） */
const editingVersions = computed(() =>
  existed.value ? stringingStore.stringings.find((s) => s.id === editor.targetId.value)?.noteVersions ?? [] : [],
);

function toPayload(): DraftPayload {
  return {
    guqinNo: form.value.guqinNo,
    stringType: form.value.stringType,
    nut: form.value.nut,
    stringGap: Number(form.value.stringGap) || 0,
    defects: form.value.defects.length ? form.value.defects : (['无'] as StringDefect[]),
    strungAt: new Date(`${form.value.strungAt}T09:00:00`).toISOString(),
    operator: form.value.operator,
    sanNote: tone.value.sanNote,
    anNote: tone.value.anNote,
    fanNote: tone.value.fanNote,
    nineVirtues: tone.value.nineVirtues,
  };
}

function applyPayload(payload: DraftPayload) {
  form.value = {
    guqinNo: String(payload.guqinNo ?? ''),
    stringType: (payload.stringType as StringType) ?? '丝弦',
    nut: String(payload.nut ?? ''),
    stringGap: Number(payload.stringGap) || 0,
    defects: Array.isArray(payload.defects) && payload.defects.length ? (payload.defects as StringDefect[]) : ['无'],
    strungAt: payload.strungAt ? String(payload.strungAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    operator: String(payload.operator ?? ''),
  };
  tone.value = {
    sanNote: String(payload.sanNote ?? ''),
    anNote: String(payload.anNote ?? ''),
    fanNote: String(payload.fanNote ?? ''),
    nineVirtues: String(payload.nineVirtues ?? ''),
  };
}

async function openCreate() {
  armed.value = false;
  const payload = editor.begin(newStringingDraftId(), false, {
    ...emptyForm(boardStore.guqinNos[0] ?? 'Q-2506'),
    ...defaultTone(),
  });
  applyPayload(payload);
  await nextTick();
  armed.value = true;
}

async function openEdit(stringing: Stringing) {
  armed.value = false;
  const payload = editor.begin(stringing.id, true, {
    guqinNo: stringing.guqinNo,
    stringType: stringing.stringType,
    nut: stringing.nut,
    stringGap: stringing.stringGap,
    defects: [...stringing.defects],
    strungAt: stringing.strungAt,
    operator: stringing.operator,
    sanNote: stringing.sanNote,
    anNote: stringing.anNote,
    fanNote: stringing.fanNote,
    nineVirtues: stringing.nineVirtues,
  });
  applyPayload(payload);
  await nextTick();
  armed.value = true;
}

async function resumeDraft(draft: ProcessDraft) {
  armed.value = false;
  const payload = editor.begin(draft.targetId, draft.existed, {}, draft);
  applyPayload(payload);
  await nextTick();
  armed.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  try {
    const result = await editor.runCommit(
      (d) => stringingStore.prepareCommit(d),
      (d, resolved) => stringingStore.commitDraft(d, resolved),
      toPayload(),
      labels,
    );
    if (result === 'committed') {
      ElMessage.success(existed ? '已提交评语改动到正式档案，改动前的正式评语已存入版本对照' : `已登记 ${form.value.guqinNo} 的上弦与音色评语`);
    } else {
      ElMessage.warning('检测到另一页签的并发改动，请在弹窗中逐字段确认后重试');
    }
  } catch (error) {
    ElMessage.error(`提交失败，正式档案未改动、草稿已保留：${(error as Error).message}`);
  }
}

async function resolveConflict(resolved: Record<string, 'mine' | 'theirs'>) {
  const result = await editor.resolveAndCommit(
    (d) => stringingStore.prepareCommit(d),
    (d, choice) => stringingStore.commitDraft(d, choice),
    resolved,
    toPayload(),
  );
  if (result === 'committed') {
    ElMessage.success('已按所选内容合并写入正式档案');
  } else {
    ElMessage.warning('弹窗期间正式档案又有新提交，请再次确认双方改动');
  }
}

async function remove(stringing: Stringing) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${stringing.guqinNo} 的上弦记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await stringingStore.removeStringing(stringing.id);
  ElMessage.success('已删除');
}

async function discardDraft() {
  const confirmed = await ElMessageBox.confirm('放弃本草稿？已填内容会从草稿区删除（正式档案不受影响）。', '放弃草稿', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await editor.discard();
}
</script>

<template>
  <div>
    <h2 class="page-title">上弦记录与音色文字评价</h2>
    <p class="page-desc">散音 / 按音 / 泛音三段评语均为纯文本；编辑先存本页签草稿，提交核对版本后才写入正式档案，评语历史版本只在正式落档时生成。</p>

    <el-alert
      v-if="pendingDrafts.length"
      type="warning"
      show-icon
      :closable="false"
      class="block"
      title="本页签有未提交的上弦/评语草稿（正式档案尚未改动）"
    >
      <div class="draft-list">
        <el-button v-for="draft in pendingDrafts" :key="draft.id" link type="primary" @click="resumeDraft(draft)">
          继续：{{ String(draft.payload.guqinNo || '琴号未填') }}
        </el-button>
      </div>
    </el-alert>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记上弦记录</el-button>
      <el-tag type="info" effect="plain">九德：{{ NINE_VIRTUES.join(' · ') }}</el-tag>
      <el-tag v-if="stringingStore.defectCount" type="warning" effect="plain">正式档案有缺陷记录 {{ stringingStore.defectCount }} 条</el-tag>
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

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的上弦记录" action-text="登记上弦记录" @action="openCreate" />

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
          <template #default="scope">{{ scope.row.noteVersions.length }} 个</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openEdit(scope.row)">编辑评语</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="existed ? '编辑上弦记录与评语（草稿）' : '登记上弦记录（草稿）'" width="820px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" class="draft-hint" title="内容自动保存为本页签草稿；只有点“提交”并通过版本核对，才会写入正式档案。" />
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
        <el-button @click="discardDraft">放弃草稿</el-button>
        <el-button @click="editor.close()">关闭（保留草稿）</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交到正式档案</el-button>
      </template>
    </el-dialog>

    <ConflictDialog :context="commitContext" :submitting="submitting" @resolve="resolveConflict" @cancel="editor.cancelCommitDialog()" />
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
.draft-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.draft-hint {
  margin-bottom: 12px;
}
</style>
