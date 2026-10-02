<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import LayerStack from '../components/common/LayerStack.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useLacquerStore } from '../stores/lacquerStore';
import { useBoardStore } from '../stores/boardStore';
import { useDraftStore } from '../stores/draftStore';
import { useFormDraft } from '../hooks/useFormDraft';
import { averageThickness, curingInRange, formatDate, layersToTarget, TARGET_TOTAL_MM } from '../utils/layer';
import { emptyLacquerForm, lacquerToForm } from '../utils/forms';
import { MIX_RATIOS, type LacquerLayer } from '../types/lacquer-layer';
import type { LacquerDraftForm } from '../types/draft';

const route = useRoute();
const router = useRouter();
const lacquerStore = useLacquerStore();
const boardStore = useBoardStore();
const draftStore = useDraftStore();

const guqinOptions = computed(() => Array.from(new Set([...boardStore.guqinNos, ...lacquerStore.guqinNos])).sort());
const selectedGuqin = ref(guqinOptions.value[0] ?? '');
watch(guqinOptions, (list) => {
  if (!selectedGuqin.value && list.length) {
    selectedGuqin.value = list[0];
  }
});

const layers = computed(() => (selectedGuqin.value ? lacquerStore.layersOf(selectedGuqin.value) : []));
const total = computed(() => (selectedGuqin.value ? lacquerStore.totalOf(selectedGuqin.value) : 0));
const abnormal = computed(() => layers.value.filter((layer) => !curingInRange(layer.curingTemp, layer.curingHumidity)).length);

const dialogVisible = ref(false);
const formRef = ref<FormInstance>();

const form = ref<LacquerDraftForm>(emptyLacquerForm());

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  operator: [{ required: true, message: '请输入髹漆人', trigger: 'blur' }],
};

const draftSession = useFormDraft<LacquerDraftForm>({
  kind: 'lacquer',
  form,
  guqinNo: () => form.value.guqinNo,
  toPayload: (value) => ({ kind: 'lacquer', form: value }),
  commit: (req) =>
    lacquerStore.commitLayer({
      mode: req.mode,
      sessionId: req.sessionId,
      form: req.form,
      base: req.mode === 'edit' ? (req.base as LacquerLayer) : null,
      resolutions: req.resolutions,
      expectedRev: req.expectedRev,
    }),
});
const { mode, conflict, submitting, restoredAt } = draftSession;
const conflictVisible = ref(false);

function openAppend() {
  form.value = {
    ...emptyLacquerForm(),
    guqinNo: selectedGuqin.value || guqinOptions.value[0] || 'Q-2501',
  };
  const restored = draftSession.beginCreate();
  if (restored) form.value = restored;
  dialogVisible.value = true;
  ElMessage.info(restored ? '已恢复本页签上次未提交的髹漆草稿' : '填写内容会自动存为本页签草稿，提交成功才进入正式档案');
}

function openEdit(layer: LacquerLayer) {
  form.value = lacquerToForm(layer);
  const restored = draftSession.beginEdit(layer, layer);
  if (restored) {
    form.value = restored;
    ElMessage.warning('已恢复本页签此前编辑该遍记录的草稿，将按当前打开的版本核对提交');
  }
  dialogVisible.value = true;
}

async function resumeFromQuery() {
  const resumeId = typeof route.query.resumeDraft === 'string' ? route.query.resumeDraft : '';
  if (!resumeId || !resumeId.includes(':lacquer:')) return;
  await draftStore.hydrate();
  const draft = await draftStore.get(resumeId);
  if (!draft || draft.kind !== 'lacquer') return;
  form.value = draftSession.restore(draft);
  selectedGuqin.value = form.value.guqinNo;
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
    const created = result as LacquerLayer;
    selectedGuqin.value = created.guqinNo;
    ElMessage.success(
      mode.value === 'edit'
        ? `已提交第 ${created.seq} 遍的修改，累计厚度 ${created.totalThickness.toFixed(2)}mm`
        : `已追加第 ${created.seq} 遍，累计厚度 ${created.totalThickness.toFixed(2)}mm`,
    );
    dialogVisible.value = false;
    return;
  }
  conflictVisible.value = true;
  ElMessage.error('髹漆正式档案已被其他页签改动，提交未写入；请在冲突核对中选择双方改动后重试');
}

async function retryWithResolutions(resolutions: Record<string, 'ours' | 'theirs'>) {
  const { ok: committed, result } = await draftSession.retryCommit(resolutions);
  if (committed) {
    conflictVisible.value = false;
    const created = result as LacquerLayer;
    selectedGuqin.value = created.guqinNo;
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

async function remove(layer: LacquerLayer) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${layer.guqinNo} 第 ${layer.seq} 遍记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await lacquerStore.removeLayer(layer.id);
  ElMessage.success('已删除并重算累计厚度');
}
</script>

<template>
  <div>
    <h2 class="page-title">灰胎髹漆遍次台账</h2>
    <p class="page-desc">按遍次累加灰胎厚度，记录荫房温湿度与打磨目数；工艺窗口为 20~30℃ / 70~85%。遍次内容先存本页签草稿，提交时按版本核对。</p>

    <div class="toolbar">
      <el-button type="primary" @click="openAppend">追加髹漆遍次</el-button>
      <el-select v-model="selectedGuqin" placeholder="选择琴号" style="width: 180px">
        <el-option v-for="no in guqinOptions" :key="no" :label="no" :value="no" />
      </el-select>
      <el-tag type="warning" effect="plain">髹漆目标累计 {{ TARGET_TOTAL_MM }}mm</el-tag>
    </div>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="该琴髹漆遍次" :value="layers.length" unit="遍" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="累计厚度" :value="total.toFixed(2)" unit="mm" :status="total >= TARGET_TOTAL_MM ? 'success' : 'warning'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="每遍平均厚度" :value="averageThickness(layers)" unit="mm" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="荫房超窗口遍次" :value="abnormal" unit="遍" :status="abnormal ? 'danger' : 'success'" />
      </el-col>
    </el-row>

    <EmptyPanel v-if="layers.length === 0" description="该琴暂无髹漆遍次记录" action-text="追加髹漆遍次" @action="openAppend" />

    <template v-else>
      <el-card shadow="never" class="block">
        <template #header>
          <div class="card-head">
            <span>层积与累计厚度（LayerStack）</span>
            <span class="card-note">按正式档案当前每遍厚度，距目标还需约 {{ layersToTarget(layers, TARGET_TOTAL_MM) }} 遍</span>
          </div>
        </template>
        <LayerStack :layers="layers" />
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>髹漆正式档案（遍次明细）</template>
        <el-table :data="layers" size="small" border>
          <el-table-column prop="seq" label="遍次" width="70" />
          <el-table-column prop="mixRatio" label="灰胎配比" width="100" />
          <el-table-column prop="curingTemp" label="荫房温度(℃)" width="110" />
          <el-table-column prop="curingHumidity" label="湿度(%)" width="90" />
          <el-table-column label="温湿度" width="100">
            <template #default="scope">
              <el-tag :type="curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? 'success' : 'danger'" size="small">
                {{ curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? '窗口内' : '超窗口' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="polishGrit" label="打磨目数" width="100" />
          <el-table-column prop="layerThickness" label="本遍(mm)" width="90" />
          <el-table-column prop="totalThickness" label="累计(mm)" width="90" />
          <el-table-column label="施工日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.appliedAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="髹漆人" width="90" />
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
    </template>

    <el-dialog v-model="dialogVisible" :title="mode === 'edit' ? '编辑髹漆遍次（草稿）' : '追加髹漆遍次（草稿）'" width="640px" :close-on-click-modal="false">
      <el-alert
        v-if="restoredAt"
        :title="`恢复自本页签暂存的草稿（${formatDate(restoredAt)}）`"
        type="info"
        :closable="false"
        show-icon
        class="draft-tip"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="130px">
        <el-form-item label="琴号" prop="guqinNo">
          <el-input v-model="form.guqinNo" placeholder="如：Q-2501" maxlength="20" style="width: 200px" />
        </el-form-item>
        <el-form-item label="灰胎配比">
          <el-select v-model="form.mixRatio" style="width: 200px">
            <el-option v-for="ratio in MIX_RATIOS" :key="ratio" :label="ratio" :value="ratio" />
          </el-select>
        </el-form-item>
        <el-form-item label="荫房温度(℃)">
          <el-input-number v-model="form.curingTemp" :min="5" :max="45" placeholder="荫房温度" />
        </el-form-item>
        <el-form-item label="荫房湿度(%)">
          <el-input-number v-model="form.curingHumidity" :min="30" :max="100" placeholder="荫房湿度" />
        </el-form-item>
        <el-form-item label="打磨目数">
          <el-input-number v-model="form.polishGrit" :min="80" :max="2000" :step="20" placeholder="打磨目数" />
        </el-form-item>
        <el-form-item label="本遍厚度(mm)">
          <el-input-number v-model="form.layerThickness" :min="0.01" :max="1" :step="0.01" :precision="2" placeholder="本遍厚度" />
        </el-form-item>
        <el-form-item label="施工日期">
          <el-date-picker v-model="form.appliedAt" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="髹漆人" prop="operator">
          <el-input v-model="form.operator" placeholder="如：林听雪" maxlength="16" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="60" placeholder="干燥情况等" />
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
      kind-label="髹漆"
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
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
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
.card-note {
  font-size: 12px;
  color: #8a7a68;
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
