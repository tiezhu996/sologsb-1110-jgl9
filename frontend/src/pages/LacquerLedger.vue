<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import LayerStack from '../components/common/LayerStack.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import ConflictDialog from '../components/common/ConflictDialog.vue';
import { useLacquerStore, newLacquerDraftId } from '../stores/lacquerStore';
import { useBoardStore } from '../stores/boardStore';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { averageThickness, curingInRange, formatDate, layersToTarget, TARGET_TOTAL_MM } from '../utils/layer';
import { RECORD_FIELDS } from '../utils/records';
import type { DraftPayload, ProcessDraft } from '../types/draft';
import { MIX_RATIOS, type LacquerLayer } from '../types/lacquer-layer';

const lacquerStore = useLacquerStore();
const boardStore = useBoardStore();

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

const formRef = ref<FormInstance>();

interface LacquerForm {
  guqinNo: string;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt: string;
  operator: string;
  remark: string;
}

const emptyForm = (guqinNo: string): LacquerForm => ({
  guqinNo,
  mixRatio: '1:1',
  curingTemp: 25,
  curingHumidity: 78,
  polishGrit: 320,
  layerThickness: 0.1,
  appliedAt: new Date().toISOString().slice(0, 10),
  operator: '林听雪',
  remark: '',
});

const form = ref<LacquerForm>(emptyForm('Q-2501'));
const armed = ref(false);

const rules: FormRules = {
  guqinNo: [{ required: true, message: '请输入琴号', trigger: 'blur' }],
  operator: [{ required: true, message: '请输入髹漆人', trigger: 'blur' }],
};

const editor = useDraftEditor({
  kind: 'lacquer',
  getRecord: (id) => lacquerStore.layers.find((l) => l.id === id),
});
const { dialogVisible, existed, commitContext, submitting, pendingDrafts } = editor;

const labels = Object.fromEntries(RECORD_FIELDS.lacquer.map((f) => [f.key, f.label]));

watch(
  form,
  () => {
    if (armed.value) editor.persist(toPayload());
  },
  { deep: true },
);

function toForm(payload: DraftPayload): LacquerForm {
  return {
    guqinNo: String(payload.guqinNo ?? ''),
    mixRatio: String(payload.mixRatio ?? '1:1'),
    curingTemp: Number(payload.curingTemp) || 0,
    curingHumidity: Number(payload.curingHumidity) || 0,
    polishGrit: Number(payload.polishGrit) || 0,
    layerThickness: Number(payload.layerThickness) || 0,
    appliedAt: payload.appliedAt ? String(payload.appliedAt).slice(0, 10) : new Date().toISOString().slice(0, 10),
    operator: String(payload.operator ?? ''),
    remark: String(payload.remark ?? ''),
  };
}

function toPayload(): DraftPayload {
  return {
    guqinNo: form.value.guqinNo,
    mixRatio: form.value.mixRatio,
    curingTemp: Number(form.value.curingTemp) || 0,
    curingHumidity: Number(form.value.curingHumidity) || 0,
    polishGrit: Number(form.value.polishGrit) || 0,
    layerThickness: Number(form.value.layerThickness) || 0,
    appliedAt: new Date(`${form.value.appliedAt}T09:00:00`).toISOString(),
    operator: form.value.operator,
    remark: form.value.remark,
  };
}

async function openAppend() {
  armed.value = false;
  const payload = editor.begin(newLacquerDraftId(), false, emptyForm(selectedGuqin.value || guqinOptions.value[0] || 'Q-2501'));
  form.value = toForm(payload);
  await nextTick();
  armed.value = true;
}

async function openEdit(layer: LacquerLayer) {
  armed.value = false;
  const payload = editor.begin(layer.id, true, {
    guqinNo: layer.guqinNo,
    mixRatio: layer.mixRatio,
    curingTemp: layer.curingTemp,
    curingHumidity: layer.curingHumidity,
    polishGrit: layer.polishGrit,
    layerThickness: layer.layerThickness,
    appliedAt: layer.appliedAt,
    operator: layer.operator,
    remark: layer.remark ?? '',
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
      (d) => lacquerStore.prepareCommit(d),
      (d, resolved) => lacquerStore.commitDraft(d, resolved),
      toPayload(),
      labels,
    );
    if (result === 'committed') {
      selectedGuqin.value = form.value.guqinNo;
      ElMessage.success(existed ? '已提交该遍改动到正式档案并重算累计厚度' : '已追加为正式档案的新一遍，累计厚度已重算');
    } else {
      ElMessage.warning('检测到另一页签的并发改动，请在弹窗中逐字段确认后重试');
    }
  } catch (error) {
    ElMessage.error(`提交失败，正式档案未改动、草稿已保留：${(error as Error).message}`);
  }
}

async function resolveConflict(resolved: Record<string, 'mine' | 'theirs'>) {
  const result = await editor.resolveAndCommit(
    (d) => lacquerStore.prepareCommit(d),
    (d, choice) => lacquerStore.commitDraft(d, choice),
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

async function remove(layer: LacquerLayer) {
  const confirmed = await ElMessageBox.confirm(`确认删除正式档案中 ${layer.guqinNo} 第 ${layer.seq} 遍记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await lacquerStore.removeLayer(layer.id);
  ElMessage.success('已删除并重算累计厚度');
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
    <h2 class="page-title">灰胎髹漆遍次台账</h2>
    <p class="page-desc">按遍次累加灰胎厚度，记录荫房温湿度与打磨目数；工艺窗口为 20~30℃ / 70~85%。追加/编辑先存本页签草稿，提交时才分配遍次并写入正式档案，两页签同时追加不会互相盖掉。</p>

    <el-alert
      v-if="pendingDrafts.length"
      type="warning"
      show-icon
      :closable="false"
      class="block"
      title="本页签有未提交的髹漆草稿（正式档案尚未改动，遍次在提交时分配）"
    >
      <div class="draft-list">
        <el-button v-for="draft in pendingDrafts" :key="draft.id" link type="primary" @click="resumeDraft(draft)">
          继续：{{ String(draft.payload.guqinNo || '琴号未填') }} · {{ draft.existed ? '编辑已存遍次' : '追加新遍' }}
        </el-button>
      </div>
    </el-alert>

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
            <span class="card-note">按当前每遍厚度，距目标还需约 {{ layersToTarget(layers, TARGET_TOTAL_MM) }} 遍</span>
          </div>
        </template>
        <LayerStack :layers="layers" />
      </el-card>

      <el-card shadow="never" class="block">
        <template #header>遍次明细（正式档案）</template>
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
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
              <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <el-dialog v-model="dialogVisible" :title="existed ? '编辑髹漆遍次（草稿）' : '追加髹漆遍次（草稿）'" width="640px" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" class="draft-hint" title="内容自动保存为本页签草稿；提交通过版本核对后才写入正式档案，新遍次号在提交时按正式档案分配。" />
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
.draft-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
.draft-hint {
  margin-bottom: 12px;
}
</style>
