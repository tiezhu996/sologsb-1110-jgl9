<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import DimensionChart from '../components/common/DimensionChart.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore, newChamberDraftId } from '../stores/chamberStore';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { formatDate } from '../utils/layer';
import { RECORD_FIELDS } from '../utils/records';
import type { DraftPayload, ProcessDraft } from '../types/draft';
import { POST_POSITIONS, type PostPos, type SoundChamber } from '../types/sound-chamber';

const boardStore = useBoardStore();
const chamberStore = useChamberStore();

const formRef = ref<FormInstance>();
const selectedGuqin = ref(chamberStore.chambers[0]?.guqinNo ?? '');

interface ChamberForm {
  guqinNo: string;
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
  carvedAt: string;
  carver: string;
  remark: string;
}

const emptyForm = (guqinNo: string): ChamberForm => ({
  guqinNo,
  nayinThickness: 15,
  longchiThickness: 13,
  fengzhaoThickness: 14,
  chamberDepth: 26,
  postPos: '天柱中',
  poolSize: '200×22',
  carvedAt: new Date().toISOString().slice(0, 10),
  carver: '周砚秋',
  remark: '',
});

const form = ref<ChamberForm>(emptyForm('Q-2506'));
const armed = ref(false);

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  carver: [{ required: true, message: '请输入掏膛人', trigger: 'blur' }],
};

const editor = useDraftEditor({
  kind: 'chamber',
  getRecord: (id) => chamberStore.chambers.find((c) => c.id === id),
});
const { dialogVisible, existed, commitContext, submitting, pendingDrafts } = editor;

const labels = Object.fromEntries(RECORD_FIELDS.chamber.map((f) => [f.key, f.label]));

watch(
  form,
  () => {
    if (armed.value) editor.persist(toPayload());
  },
  { deep: true },
);

const chartMarks = computed(() => (selectedGuqin.value ? chamberStore.marksOf(selectedGuqin.value) : []));
const chartDepth = computed(() => chamberStore.byGuqin(selectedGuqin.value)?.chamberDepth ?? 0);
const spread = computed(() => (selectedGuqin.value ? chamberStore.thicknessSpread(selectedGuqin.value) : 0));
const depthRatio = computed(() => (selectedGuqin.value ? chamberStore.depthRatio(selectedGuqin.value) : 0));

function toForm(payload: DraftPayload): ChamberForm {
  return {
    guqinNo: String(payload.guqinNo ?? ''),
    nayinThickness: Number(payload.nayinThickness) || 0,
    longchiThickness: Number(payload.longchiThickness) || 0,
    fengzhaoThickness: Number(payload.fengzhaoThickness) || 0,
    chamberDepth: Number(payload.chamberDepth) || 0,
    postPos: (payload.postPos as PostPos) ?? '天柱中',
    poolSize: String(payload.poolSize ?? ''),
    carvedAt: payload.carvedAt ? String(payload.carvedAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    carver: String(payload.carver ?? ''),
    remark: String(payload.remark ?? ''),
  };
}

function toPayload(): DraftPayload {
  return {
    guqinNo: form.value.guqinNo,
    nayinThickness: Number(form.value.nayinThickness) || 0,
    longchiThickness: Number(form.value.longchiThickness) || 0,
    fengzhaoThickness: Number(form.value.fengzhaoThickness) || 0,
    chamberDepth: Number(form.value.chamberDepth) || 0,
    postPos: form.value.postPos,
    poolSize: form.value.poolSize,
    carvedAt: new Date(`${form.value.carvedAt}T09:00:00`).toISOString(),
    carver: form.value.carver,
    remark: form.value.remark,
  };
}

async function openCreate() {
  armed.value = false;
  const payload = editor.begin(newChamberDraftId(), false, emptyForm(boardStore.guqinNos[0] ?? 'Q-2506'));
  form.value = toForm(payload);
  await nextTick();
  armed.value = true;
}

async function openEdit(chamber: SoundChamber) {
  armed.value = false;
  const payload = editor.begin(chamber.id, true, {
    guqinNo: chamber.guqinNo,
    nayinThickness: chamber.nayinThickness,
    longchiThickness: chamber.longchiThickness,
    fengzhaoThickness: chamber.fengzhaoThickness,
    chamberDepth: chamber.chamberDepth,
    postPos: chamber.postPos,
    poolSize: chamber.poolSize,
    carvedAt: chamber.carvedAt,
    carver: chamber.carver,
    remark: chamber.remark ?? '',
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
      (d) => chamberStore.prepareCommit(d),
      (d, resolved) => chamberStore.commitDraft(d, resolved),
      toPayload(),
      labels,
    );
    if (result === 'committed') {
      selectedGuqin.value = form.value.guqinNo;
      ElMessage.success(`已提交 ${form.value.guqinNo} 的槽腹尺寸到正式档案`);
    } else {
      ElMessage.warning('检测到另一页签的并发改动，请在弹窗中逐字段确认后重试');
    }
  } catch (error) {
    ElMessage.error(`提交失败，正式档案未改动、草稿已保留：${(error as Error).message}`);
  }
}

async function resolveConflict(resolved: Record<string, 'mine' | 'theirs'>) {
  const result = await editor.resolveAndCommit(
    (d) => chamberStore.prepareCommit(d),
    (d, choice) => chamberStore.commitDraft(d, choice),
    resolved,
    toPayload(),
  );
  if (result === 'committed') {
    selectedGuqin.value = form.value.guqinNo;
    ElMessage.success('已按所选内容合并写入正式档案');
  } else {
    ElMessage.warning('弹窗期间正式档案又有新提交，请再次确认双方改动');
  }
}

async function remove(chamber: SoundChamber) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${chamber.guqinNo} 的槽腹记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await chamberStore.removeChamber(chamber.id);
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
    <h2 class="page-title">槽腹尺寸记录</h2>
    <p class="page-desc">录入纳音 / 龙池 / 凤沼三处面板厚度即绘制槽腹剖面标注，并给出厚度极差与深径比。编辑先存本页签草稿，提交核对版本后才写入正式档案。</p>

    <el-alert
      v-if="pendingDrafts.length"
      type="warning"
      show-icon
      :closable="false"
      class="block"
      title="本页签有未提交的槽腹草稿（正式档案尚未改动）"
    >
      <div class="draft-list">
        <el-button v-for="draft in pendingDrafts" :key="draft.id" link type="primary" @click="resumeDraft(draft)">
          继续：{{ String(draft.payload.guqinNo || '琴号未填') }}
        </el-button>
      </div>
    </el-alert>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增槽腹记录</el-button>
      <el-select v-model="selectedGuqin" clearable placeholder="选择琴号查看剖面" style="width: 200px">
        <el-option v-for="chamber in chamberStore.chambers" :key="chamber.id" :label="`${chamber.guqinNo} · 深 ${chamber.chamberDepth}mm`" :value="chamber.guqinNo" />
      </el-select>
      <el-tag v-if="selectedGuqin" type="info" effect="plain">三处厚度极差 {{ spread }} mm · 深径比 {{ depthRatio }}</el-tag>
    </div>

    <EmptyPanel v-if="chamberStore.chambers.length === 0" description="暂无槽腹记录" action-text="新增槽腹记录" @action="openCreate" />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>槽腹剖面标注（DimensionChart）</template>
        <DimensionChart v-if="chartMarks.length" :marks="chartMarks" :chamber-depth="chartDepth" :guqin-no="selectedGuqin" />
        <el-empty v-else :image-size="60" description="请选择琴号以查看剖面标注" />
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>槽腹台账（正式档案）</template>
        <el-table :data="chamberStore.chambers" size="small" border>
          <el-table-column prop="guqinNo" label="琴号" width="100" />
          <el-table-column prop="nayinThickness" label="纳音(mm)" width="100" />
          <el-table-column prop="longchiThickness" label="龙池(mm)" width="100" />
          <el-table-column prop="fengzhaoThickness" label="凤沼(mm)" width="100" />
          <el-table-column prop="chamberDepth" label="槽腹深度(mm)" width="120" />
          <el-table-column prop="postPos" label="天地柱" width="110" />
          <el-table-column prop="poolSize" label="龙池凤沼尺寸" width="130" />
          <el-table-column label="掏膛日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.carvedAt) }}</template>
          </el-table-column>
          <el-table-column prop="carver" label="掏膛人" width="90" />
          <el-table-column prop="remark" label="备注" min-width="140" />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="existed ? '编辑槽腹记录（草稿）' : '新增槽腹记录（草稿）'" width="680px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" class="draft-hint" title="内容自动保存为本页签草稿；只有点“提交”并通过版本核对，才会写入正式档案。" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="150px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2506" maxlength="20" />
        </el-form-item>
        <el-form-item label="纳音处面板厚度(mm)">
          <el-input-number v-model="form.nayinThickness" :min="5" :max="40" :step="0.5" placeholder="纳音厚度" />
        </el-form-item>
        <el-form-item label="龙池处面板厚度(mm)">
          <el-input-number v-model="form.longchiThickness" :min="5" :max="40" :step="0.5" placeholder="龙池厚度" />
        </el-form-item>
        <el-form-item label="凤沼处面板厚度(mm)">
          <el-input-number v-model="form.fengzhaoThickness" :min="5" :max="40" :step="0.5" placeholder="凤沼厚度" />
        </el-form-item>
        <el-form-item label="槽腹深度(mm)">
          <el-input-number v-model="form.chamberDepth" :min="10" :max="60" :step="0.5" placeholder="槽腹深度" />
        </el-form-item>
        <el-form-item label="天地柱位置">
          <el-select v-model="form.postPos" style="width: 200px">
            <el-option v-for="pos in POST_POSITIONS" :key="pos" :label="pos" :value="pos" />
          </el-select>
        </el-form-item>
        <el-form-item label="龙池凤沼尺寸">
          <el-input v-model="form.poolSize" placeholder="如：200×22" maxlength="20" style="width: 200px" />
        </el-form-item>
        <el-form-item label="掏膛日期">
          <el-date-picker v-model="form.carvedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="掏膛人" prop="carver">
          <el-input v-model="form.carver" placeholder="如：周砚秋" maxlength="16" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="出音倾向等" />
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
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
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
