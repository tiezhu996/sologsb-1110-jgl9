<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import DimensionChart from '../components/common/DimensionChart.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useBoardStore, newBoardDraftId } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { useGuqinFilter } from '../hooks/useGuqinFilter';
import { thicknessGap } from '../utils/wood';
import { formatDate } from '../utils/layer';
import { RECORD_FIELDS } from '../utils/records';
import type { DraftPayload, ProcessDraft } from '../types/draft';
import {
  BOARD_PARTS,
  WOOD_DEFECTS,
  WOOD_GRAINS,
  WOOD_SPECIES,
  type BoardPart,
  type WoodBoard,
  type WoodDefect,
  type WoodGrain,
  type WoodSpecies,
} from '../types/wood-board';

const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const filter = useGuqinFilter();

const formRef = ref<FormInstance>();
const selectedGuqin = ref('');

interface BoardForm {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt: string;
  remark: string;
}

const emptyForm = (guqinNo: string): BoardForm => ({
  boardNo: `MB-${Date.now().toString().slice(-4)}`,
  guqinNo,
  part: '面板',
  species: '桐木',
  dryYears: 5,
  thicknessMm: 30,
  grain: '直纹',
  defect: '无',
  receivedAt: new Date().toISOString().slice(0, 10),
  remark: '',
});

const form = ref<BoardForm>(emptyForm('Q-2506'));
const armed = ref(false);

const rules: FormRules = {
  boardNo: [{ required: true, message: '请输入板材号', trigger: 'blur' }],
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
};

const editor = useDraftEditor({
  kind: 'board',
  getRecord: (id) => boardStore.boards.find((b) => b.id === id),
});
const { dialogVisible, targetId, existed, commitContext, submitting, pendingDrafts } = editor;

const labels = Object.fromEntries(RECORD_FIELDS.board.map((f) => [f.key, f.label]));

watch(
  form,
  () => {
    if (armed.value) editor.persist(toPayload());
  },
  { deep: true },
);

const visible = computed(() => filter.applyBoards(boardStore.boards));
const visiblePairs = computed(() => {
  const nos = new Set(visible.value.map((b) => b.guqinNo));
  return boardStore.pairs.filter((pair) => nos.has(pair.guqinNo));
});

const chartMarks = computed(() => (selectedGuqin.value ? chamberStore.marksOf(selectedGuqin.value) : []));
const chartDepth = computed(() => chamberStore.byGuqin(selectedGuqin.value)?.chamberDepth ?? 0);

function toForm(payload: DraftPayload): BoardForm {
  return {
    boardNo: String(payload.boardNo ?? ''),
    guqinNo: String(payload.guqinNo ?? ''),
    part: (payload.part as BoardPart) ?? '面板',
    species: (payload.species as WoodSpecies) ?? '桐木',
    dryYears: Number(payload.dryYears) || 0,
    thicknessMm: Number(payload.thicknessMm) || 0,
    grain: (payload.grain as WoodGrain) ?? '直纹',
    defect: (payload.defect as WoodDefect) ?? '无',
    receivedAt: payload.receivedAt ? String(payload.receivedAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    remark: String(payload.remark ?? ''),
  };
}

function toPayload(): DraftPayload {
  return {
    boardNo: form.value.boardNo,
    guqinNo: form.value.guqinNo,
    part: form.value.part,
    species: form.value.species,
    dryYears: Number(form.value.dryYears) || 0,
    thicknessMm: Number(form.value.thicknessMm) || 0,
    grain: form.value.grain,
    defect: form.value.defect,
    receivedAt: new Date(`${form.value.receivedAt}T09:00:00`).toISOString(),
    remark: form.value.remark,
  };
}

async function openCreate() {
  armed.value = false;
  const payload = editor.begin(newBoardDraftId(), false, emptyForm(boardStore.guqinNos[0] ?? 'Q-2506'));
  form.value = toForm(payload);
  await nextTick();
  armed.value = true;
}

async function openEdit(board: WoodBoard) {
  armed.value = false;
  const payload = editor.begin(board.id, true, {
    boardNo: board.boardNo,
    guqinNo: board.guqinNo,
    part: board.part,
    species: board.species,
    dryYears: board.dryYears,
    thicknessMm: board.thicknessMm,
    grain: board.grain,
    defect: board.defect,
    receivedAt: board.receivedAt,
    remark: board.remark ?? '',
  });
  form.value = toForm(payload);
  await nextTick();
  armed.value = true;
}

async function resumeDraft(draft: ProcessDraft) {
  armed.value = false;
  const payload = editor.begin(draft.targetId, draft.existed, {}, draft);
  form.value = toForm(payload);
  await nextTick();
  armed.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  try {
    const result = await editor.runCommit(
      (d) => boardStore.prepareCommit(d),
      (d, resolved) => boardStore.commitDraft(d, resolved),
      toPayload(),
      labels,
    );
    if (result === 'committed') {
      ElMessage.success(`已提交板材 ${form.value.boardNo} 到正式档案`);
    } else {
      ElMessage.warning('检测到另一页签的并发改动，请在弹窗中逐字段确认后重试');
    }
  } catch (error) {
    ElMessage.error(`提交失败，正式档案未改动、草稿已保留：${(error as Error).message}`);
  }
}

async function resolveConflict(resolved: Record<string, 'mine' | 'theirs'>) {
  const result = await editor.resolveAndCommit(
    (d) => boardStore.prepareCommit(d),
    (d, choice) => boardStore.commitDraft(d, choice),
    resolved,
    toPayload(),
  );
  if (result === 'committed') {
    ElMessage.success('已按所选内容合并写入正式档案');
  } else {
    ElMessage.warning('弹窗期间正式档案又有新提交，请再次确认双方改动');
  }
}

async function remove(board: WoodBoard) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中的板材 ${board.boardNo}？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await boardStore.removeBoard(board.id);
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
    <h2 class="page-title">板材登记与配对</h2>
    <p class="page-desc">同一琴号下面板与底板配对绑定，并按阴干年限回显含水率；三处厚度标注由槽腹记录派生。编辑内容先存为本页签草稿，提交时核对版本后才写入正式档案。</p>

    <el-alert
      v-if="pendingDrafts.length"
      type="warning"
      show-icon
      :closable="false"
      class="block"
      title="本页签有未提交的板材草稿（正式档案尚未改动）"
    >
      <div class="draft-list">
        <el-button v-for="draft in pendingDrafts" :key="draft.id" link type="primary" @click="resumeDraft(draft)">
          继续：{{ String(draft.payload.boardNo || '未命名板材') }}（{{ String(draft.payload.guqinNo || '琴号未填') }}）
        </el-button>
      </div>
    </el-alert>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记板材</el-button>
      <el-button @click="selectedGuqin = boardStore.guqinNos[0] ?? ''">查看首张琴剖面</el-button>
    </div>

    <FilterBar
      :fields="[
        { key: 'guqin', label: '琴号', options: boardStore.guqinNos, width: 130 },
        { key: 'species', label: '树种', options: WOOD_SPECIES, width: 110 },
      ]"
      :result-count="visible.length"
      :total-count="boardStore.boards.length"
    />

    <EmptyPanel
      v-if="visible.length === 0"
      description="没有符合条件的板材"
      action-text="重置筛选条件"
      @action="filter.reset()"
    />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>面板 / 底板配对（含水率回显）</template>
        <el-table :data="visiblePairs" size="small" border>
          <el-table-column prop="guqinNo" label="琴号" width="110" />
          <el-table-column label="面板" min-width="200">
            <template #default="scope">
              <span v-if="scope.row.panel">{{ scope.row.panel.boardNo }} · {{ scope.row.panel.species }} · {{ scope.row.panel.thicknessMm }}mm</span>
              <el-tag v-else type="danger" size="small">缺面板</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="底板" min-width="200">
            <template #default="scope">
              <span v-if="scope.row.base">{{ scope.row.base.boardNo }} · {{ scope.row.base.species }} · {{ scope.row.base.thicknessMm }}mm</span>
              <el-tag v-else type="danger" size="small">缺底板</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="含水率" width="110">
            <template #default="scope">{{ scope.row.moisturePct }}%</template>
          </el-table-column>
          <el-table-column label="板厚差(mm)" width="120">
            <template #default="scope">{{ thicknessGap(scope.row) }}</template>
          </el-table-column>
          <el-table-column label="配对状态" width="110">
            <template #default="scope">
              <el-tag :type="scope.row.matched ? 'success' : 'warning'" size="small">{{ scope.row.matched ? '已配对' : '待配对' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="scope">
              <el-button link type="primary" @click="selectedGuqin = scope.row.guqinNo">剖面标注</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>板材明细（正式档案）</template>
        <el-table :data="visible" size="small" border>
          <el-table-column prop="boardNo" label="板材号" width="120" />
          <el-table-column prop="guqinNo" label="琴号" width="100" />
          <el-table-column prop="part" label="部位" width="80" />
          <el-table-column prop="species" label="树种" width="80" />
          <el-table-column prop="dryYears" label="阴干(年)" width="90" />
          <el-table-column prop="thicknessMm" label="厚度(mm)" width="90" />
          <el-table-column prop="grain" label="木纹" width="90" />
          <el-table-column prop="defect" label="缺陷" width="80" />
          <el-table-column label="入库" width="110">
            <template #default="scope">{{ formatDate(scope.row.receivedAt) }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>
          <div class="card-head">
            <span>槽腹剖面标注（DimensionChart）</span>
            <el-select v-model="selectedGuqin" placeholder="选择琴号" clearable style="width: 160px">
              <el-option v-for="no in boardStore.guqinNos" :key="no" :label="no" :value="no" />
            </el-select>
          </div>
        </template>
        <DimensionChart v-if="chartMarks.length" :marks="chartMarks" :chamber-depth="chartDepth" :guqin-no="selectedGuqin" />
        <el-empty v-else :image-size="60" description="选择已有槽腹记录的琴号即可查看剖面标注" />
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="existed ? '编辑板材（草稿）' : '登记板材（草稿）'" width="620px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" class="draft-hint" title="内容自动保存为本页签草稿；只有点“提交”并通过版本核对，才会写入正式档案。" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="板材号" prop="boardNo">
          <el-input v-model="form.boardNo" placeholder="如：MB-2511" maxlength="20" />
        </el-form-item>
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2506" maxlength="20" />
        </el-form-item>
        <el-form-item label="部位">
          <el-select v-model="form.part" style="width: 160px">
            <el-option v-for="part in BOARD_PARTS" :key="part" :label="part" :value="part" />
          </el-select>
        </el-form-item>
        <el-form-item label="树种">
          <el-select v-model="form.species" style="width: 160px">
            <el-option v-for="species in WOOD_SPECIES" :key="species" :label="species" :value="species" />
          </el-select>
        </el-form-item>
        <el-form-item label="阴干年限(年)">
          <el-input-number v-model="form.dryYears" :min="0" :max="60" placeholder="阴干年限" />
        </el-form-item>
        <el-form-item label="厚度(mm)">
          <el-input-number v-model="form.thicknessMm" :min="5" :max="80" :step="0.5" placeholder="厚度" />
        </el-form-item>
        <el-form-item label="木纹">
          <el-select v-model="form.grain" style="width: 160px">
            <el-option v-for="grain in WOOD_GRAINS" :key="grain" :label="grain" :value="grain" />
          </el-select>
        </el-form-item>
        <el-form-item label="缺陷">
          <el-select v-model="form.defect" style="width: 160px">
            <el-option v-for="defect in WOOD_DEFECTS" :key="defect" :label="defect" :value="defect" />
          </el-select>
        </el-form-item>
        <el-form-item label="入库日期">
          <el-date-picker v-model="form.receivedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="产地、纹理等" />
        </el-form-item>
      </el-form>
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
  margin-bottom: 12px;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
