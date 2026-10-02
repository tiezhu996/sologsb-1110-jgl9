<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import DimensionChart from '../components/common/DimensionChart.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useDraftStore } from '../stores/draftStore';
import { useFormDraft } from '../hooks/useFormDraft';
import { chamberToForm, emptyChamberForm } from '../utils/forms';
import { POST_POSITIONS, type PostPos, type SoundChamber } from '../types/sound-chamber';
import type { ChamberDraftForm } from '../types/draft';
import { formatDate } from '../utils/layer';

const route = useRoute();
const router = useRouter();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const draftStore = useDraftStore();

const dialogVisible = ref(false);
const formRef = ref<FormInstance>();
const selectedGuqin = ref(chamberStore.chambers[0]?.guqinNo ?? '');

const form = ref<ChamberDraftForm>(emptyChamberForm());

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  carver: [{ required: true, message: '请输入掏膛人', trigger: 'blur' }],
};

const draftSession = useFormDraft<ChamberDraftForm>({
  kind: 'chamber',
  form,
  guqinNo: () => form.value.guqinNo,
  toPayload: (value) => ({ kind: 'chamber', form: value }),
  commit: (req) =>
    chamberStore.commitChamber({
      mode: req.mode,
      sessionId: req.sessionId,
      form: req.form,
      base: req.mode === 'edit' ? (req.base as SoundChamber) : null,
      resolutions: req.resolutions,
      expectedRev: req.expectedRev,
    }),
});
const { mode, conflict, submitting, restoredAt } = draftSession;
const conflictVisible = ref(false);

const chartMarks = computed(() => (selectedGuqin.value ? chamberStore.marksOf(selectedGuqin.value) : []));
const chartDepth = computed(() => chamberStore.byGuqin(selectedGuqin.value)?.chamberDepth ?? 0);
const spread = computed(() => (selectedGuqin.value ? chamberStore.thicknessSpread(selectedGuqin.value) : 0));
const depthRatio = computed(() => (selectedGuqin.value ? chamberStore.depthRatio(selectedGuqin.value) : 0));

function openCreate() {
  form.value = { ...emptyChamberForm(), guqinNo: boardStore.guqinNos[0] ?? 'Q-2506' };
  const restored = draftSession.beginCreate();
  if (restored) form.value = restored;
  dialogVisible.value = true;
  ElMessage.info(restored ? '已恢复本页签上次未提交的槽腹草稿' : '填写内容会自动存为本页签草稿，提交成功才进入正式档案');
}

function openEdit(chamber: SoundChamber) {
  form.value = chamberToForm(chamber);
  const restored = draftSession.beginEdit(chamber, chamber);
  if (restored) {
    form.value = restored;
    ElMessage.warning('已恢复本页签此前编辑该槽腹档案的草稿，将按当前打开的版本核对提交');
  }
  dialogVisible.value = true;
}

async function resumeFromQuery() {
  const resumeId = typeof route.query.resumeDraft === 'string' ? route.query.resumeDraft : '';
  if (!resumeId || !resumeId.includes(':chamber:')) return;
  await draftStore.hydrate();
  const draft = await draftStore.get(resumeId);
  if (!draft || draft.kind !== 'chamber') return;
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
  const { ok: committed, result } = await draftSession.submitCommit();
  if (committed) {
    selectedGuqin.value = (result as SoundChamber).guqinNo;
    ElMessage.success(`已提交 ${(result as SoundChamber).guqinNo} 的槽腹尺寸到正式档案`);
    dialogVisible.value = false;
    return;
  }
  conflictVisible.value = true;
  ElMessage.error('槽腹正式档案已被其他页签改动，提交未写入；请在冲突核对中选择双方改动后重试');
}

async function retryWithResolutions(resolutions: Record<string, 'ours' | 'theirs'>) {
  const { ok: committed, result } = await draftSession.retryCommit(resolutions);
  if (committed) {
    conflictVisible.value = false;
    selectedGuqin.value = (result as SoundChamber).guqinNo;
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

async function remove(chamber: SoundChamber) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${chamber.guqinNo} 的槽腹记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await chamberStore.removeChamber(chamber.id);
  ElMessage.success('已删除正式档案');
}
</script>

<template>
  <div>
    <h2 class="page-title">槽腹尺寸记录</h2>
    <p class="page-desc">录入纳音 / 龙池 / 凤沼三处面板厚度即绘制槽腹剖面标注，并给出厚度极差与深径比。填写内容先存本页签草稿，提交时按版本核对。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">新增槽腹记录</el-button>
      <el-select v-model="selectedGuqin" clearable placeholder="选择琴号查看剖面" style="width: 200px">
        <el-option v-for="chamber in chamberStore.chambers" :key="chamber.id" :label="`${chamber.guqinNo} · 深 ${chamber.chamberDepth}mm`" :value="chamber.guqinNo" />
      </el-select>
      <el-tag v-if="selectedGuqin" type="info" effect="plain">三处厚度极差 {{ spread }} mm · 深径比 {{ depthRatio }}</el-tag>
    </div>

    <EmptyPanel v-if="chamberStore.chambers.length === 0" description="暂无槽腹正式档案" action-text="新增槽腹记录" @action="openCreate" />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>槽腹剖面标注（DimensionChart）</template>
        <DimensionChart v-if="chartMarks.length" :marks="chartMarks" :chamber-depth="chartDepth" :guqin-no="selectedGuqin" />
        <el-empty v-else :image-size="60" description="请选择琴号以查看剖面标注" />
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>槽腹正式档案</template>
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
    </template>

    <el-dialog v-model="dialogVisible" :title="mode === 'edit' ? '编辑槽腹记录（草稿）' : '新增槽腹记录（草稿）'" width="680px" :close-on-click-modal="false">
      <el-alert
        v-if="restoredAt"
        :title="`恢复自本页签暂存的草稿（${formatDate(restoredAt)}）`"
        type="info"
        :closable="false"
        show-icon
        class="draft-tip"
      />
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
      kind-label="槽腹"
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
  margin-bottom: 16px;
  border-radius: 8px;
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
