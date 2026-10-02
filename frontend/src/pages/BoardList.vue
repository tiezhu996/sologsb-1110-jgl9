<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import DimensionChart from '../components/common/DimensionChart.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useDraftStore } from '../stores/draftStore';
import { useGuqinFilter } from '../hooks/useGuqinFilter';
import { useFormDraft } from '../hooks/useFormDraft';
import { thicknessGap } from '../utils/wood';
import { formatDate } from '../utils/layer';
import { boardToForm, emptyBoardForm } from '../utils/forms';
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
import type { BoardDraftForm } from '../types/draft';

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const draftStore = useDraftStore();
const filter = useGuqinFilter();

const dialogVisible = ref(false);
const formRef = ref<FormInstance>();
const selectedGuqin = ref('');

const form = ref<BoardDraftForm>(emptyBoardForm());

const rules: FormRules = {
  boardNo: [{ required: true, message: '请输入板材号', trigger: 'blur' }],
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
};

const draftSession = useFormDraft<BoardDraftForm>({
  kind: 'board',
  form,
  guqinNo: () => form.value.guqinNo,
  toPayload: (value) => ({ kind: 'board', form: value }),
  commit: (req) =>
    boardStore.commitBoard({
      mode: req.mode,
      sessionId: req.sessionId,
      form: req.form,
      base: req.mode === 'edit' ? (req.base as WoodBoard) : null,
      resolutions: req.resolutions,
      expectedRev: req.expectedRev,
    }),
});
const { mode, conflict, submitting, restoredAt } = draftSession;
const conflictVisible = ref(false);

const visible = computed(() => filter.applyBoards(boardStore.boards));
const visiblePairs = computed(() => {
  const nos = new Set(visible.value.map((b) => b.guqinNo));
  return boardStore.pairs.filter((pair) => nos.has(pair.guqinNo));
});

const chartMarks = computed(() => (selectedGuqin.value ? chamberStore.marksOf(selectedGuqin.value) : []));
const chartDepth = computed(() => chamberStore.byGuqin(selectedGuqin.value)?.chamberDepth ?? 0);

function openCreate() {
  form.value = {
    ...emptyBoardForm(),
    boardNo: `MB-${Date.now().toString().slice(-4)}`,
    guqinNo: boardStore.guqinNos[0] ?? 'Q-2506',
  };
  const restored = draftSession.beginCreate();
  if (restored) form.value = restored;
  dialogVisible.value = true;
  ElMessage.info(restored ? '已恢复本页签上次未提交的板材草稿' : '填写内容会自动存为本页签草稿，提交成功才进入正式档案');
}

function openEdit(board: WoodBoard) {
  form.value = boardToForm(board);
  const restored = draftSession.beginEdit(board, board);
  if (restored) {
    form.value = restored;
    ElMessage.warning('已恢复本页签此前编辑该板材的草稿，将按当前打开的正式档案版本核对提交');
  }
  dialogVisible.value = true;
}

/** 草稿箱跳转恢复 */
async function resumeFromQuery() {
  const resumeId = typeof route.query.resumeDraft === 'string' ? route.query.resumeDraft : '';
  if (!resumeId || !resumeId.includes(':board:')) return;
  await draftStore.hydrate();
  const draft = await draftStore.get(resumeId);
  if (!draft || draft.kind !== 'board') return;
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
    ElMessage.success(`已提交板材 ${form.value.boardNo} 到正式档案`);
    dialogVisible.value = false;
    return;
  }
  // 冲突时 ConflictDialog 弹出；草稿与正式档案都保留
  conflictVisible.value = true;
  ElMessage.error('正式档案已被其他页签改动，提交未写入；请在冲突核对中选择双方改动后重试');
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
  // 取消即保留草稿（稍后可在顶栏草稿箱继续）；另提供「丢弃草稿」按钮
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

async function remove(board: WoodBoard) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中的板材 ${board.boardNo}？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await boardStore.removeBoard(board.id);
  ElMessage.success('已删除正式档案');
}
</script>

<template>
  <div>
    <h2 class="page-title">板材登记与配对</h2>
    <p class="page-desc">同一琴号下面板与底板配对绑定，并按阴干年限回显含水率；三处厚度标注由槽腹正式档案派生。填写内容先存本页签草稿，提交时按版本核对。</p>

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
        <template #header>板材正式档案</template>
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
          <el-table-column label="版本" width="70">
            <template #default="scope">v{{ scope.row.rev }}</template>
          </el-table-column>
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
        <el-empty v-else :image-size="60" description="选择已有槽腹正式档案的琴号即可查看剖面标注" />
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="mode === 'edit' ? '编辑板材（草稿）' : '登记板材（草稿）'" width="620px" :close-on-click-modal="false">
      <el-alert
        v-if="restoredAt"
        :title="`恢复自本页签暂存的草稿（${formatDate(restoredAt)}）`"
        type="info"
        :closable="false"
        show-icon
        class="draft-tip"
      />
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
      kind-label="板材"
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
.draft-tip {
  margin-bottom: 10px;
}
.dialog-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
