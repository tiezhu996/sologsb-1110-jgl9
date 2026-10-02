import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { uid } from '../utils/id';
import { getTabId } from '../utils/tab';
import { useDraftStore } from '../stores/draftStore';
import { ConflictError, type CommitConflict } from '../utils/conflict';
import type { DraftKind, DraftPayload, ProcessDraft } from '../types/draft';

export interface CommitRequest<F> {
  mode: 'create' | 'edit';
  sessionId: string;
  form: F;
  /** 页面打开时的正式档案快照；create 为 null */
  base: ProcessDraft['baseRecord'];
  baseRev: number;
  /** 冲突重试：逐字段采用哪一方 */
  resolutions?: Record<string, 'ours' | 'theirs'>;
  /** 冲突重试：上次核对到的对方版本号 */
  expectedRev?: number;
}

export interface UseFormDraftOptions<F extends object> {
  kind: DraftKind;
  form: Ref<F>;
  /** 表单当前琴号（草稿列表展示用） */
  guqinNo: () => string;
  /** 按 kind 包装成 DraftPayload */
  toPayload: (form: F) => DraftPayload;
  /** 提交到正式档案（带冲突核对）；冲突重试的 resolutions/expectedRev 原样透传给 store */
  commit: (req: CommitRequest<F>) => Promise<unknown>;
  /** 自动保存节流间隔（ms） */
  debounceMs?: number;
}

/**
 * 单个登记/编辑弹窗的草稿会话：
 * - 打开时调用 beginCreate / beginEdit，返回未提交草稿（如有）供页面回填；
 * - 表单变动后自动按页签保存到 drafts 表，与正式档案分开；
 * - submitCommit 走正式档案版本核对，冲突时草稿与正式档案都保留，可用 retryCommit 重试；
 * - 提交成功删除草稿。
 */
export function useFormDraft<F extends object>(options: UseFormDraftOptions<F>) {
  const draftStore = useDraftStore();
  const mode = ref<'create' | 'edit'>('create');
  const sessionId = ref('');
  const baseRecord = shallowRef<ProcessDraft['baseRecord']>(null);
  const baseRev = ref(0);
  const active = ref(false);
  const conflict = shallowRef<CommitConflict | null>(null);
  const submitting = ref(false);
  const saving = ref(false);
  const restoredAt = ref('');
  const lastSavedAt = ref('');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const draftId = computed(() => (sessionId.value ? `${getTabId()}:${options.kind}:${sessionId.value}` : ''));
  const existingDraft = computed(() => (draftId.value ? draftStore.drafts.find((d) => d.id === draftId.value) : undefined));

  function openSession(nextMode: 'create' | 'edit', nextSessionId: string, base: ProcessDraft['baseRecord'], rev: number): F | null {
    mode.value = nextMode;
    sessionId.value = nextSessionId;
    baseRecord.value = base;
    baseRev.value = rev;
    active.value = true;
    conflict.value = null;
    restoredAt.value = '';
    const saved = existingDraft.value;
    if (saved) {
      // 基线以本次打开为准：对方页签在这之前的提交，会在 submitCommit 时按 rev 一并核对
      saved.baseRecord = base;
      saved.baseRev = rev;
      restoredAt.value = saved.updatedAt;
      return (saved.payload as unknown as { form: F }).form ?? null;
    }
    return null;
  }

  /** 打开新增弹窗：sessionId 每次新建，同页签连续两次登记是两条草稿 */
  function beginCreate(): F | null {
    return openSession('create', uid('session'), null, 0);
  }

  /** 打开编辑弹窗：sessionId=正式档案 id，基线为打开瞬间的档案快照 */
  function beginEdit(record: { id: string; rev: number }, snapshot: ProcessDraft['baseRecord']): F | null {
    return openSession('edit', record.id, snapshot, record.rev);
  }

  /** 草稿箱跳转恢复：按草稿原有 mode/基线恢复，不重新绑定正式档案 */
  function restore(draft: ProcessDraft): F {
    mode.value = draft.mode;
    sessionId.value = draft.sessionId;
    baseRecord.value = draft.baseRecord;
    baseRev.value = draft.baseRev;
    active.value = true;
    conflict.value = null;
    restoredAt.value = draft.updatedAt;
    return (draft.payload as unknown as { form: F }).form;
  }

  async function persistNow() {
    if (!active.value || !sessionId.value) return;
    saving.value = true;
    try {
      const saved = await draftStore.save({
        kind: options.kind,
        mode: mode.value,
        sessionId: sessionId.value,
        guqinNo: options.guqinNo(),
        payload: options.toPayload(options.form.value),
        baseRecord: baseRecord.value,
        baseRev: baseRev.value,
      });
      lastSavedAt.value = saved.updatedAt;
    } finally {
      saving.value = false;
    }
  }

  // 表单变动 → 节流自动保存
  watch(
    options.form,
    () => {
      if (!active.value) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void persistNow(), options.debounceMs ?? 400);
    },
    { deep: true },
  );

  function clearTimer() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  async function runCommit(
    doCommit: () => Promise<unknown>,
  ): Promise<{ ok: boolean; result?: unknown }> {
    submitting.value = true;
    try {
      const result = await doCommit();
      clearTimer();
      await draftStore.removeSession(options.kind, sessionId.value);
      active.value = false;
      conflict.value = null;
      return { ok: true, result };
    } catch (error) {
      if (error instanceof ConflictError) {
        conflict.value = error.conflict;
        // 写入失败后草稿原样保留并刷新保存时间，可重试
        await persistNow();
        return { ok: false };
      }
      throw error;
    } finally {
      submitting.value = false;
    }
  }

  /** 提交：核对冲突；成功删草稿；冲突时草稿保留 */
  function submitCommit(): Promise<{ ok: boolean; result?: unknown }> {
    conflict.value = null;
    return runCommit(() =>
      options.commit({
        mode: mode.value,
        sessionId: sessionId.value,
        form: options.form.value,
        base: baseRecord.value,
        baseRev: baseRev.value,
      }),
    );
  }

  /** 按双方选择重试提交 */
  function retryCommit(resolutions: Record<string, 'ours' | 'theirs'>): Promise<{ ok: boolean; result?: unknown }> {
    if (!conflict.value) return Promise.resolve({ ok: false });
    const expectedRev = conflict.value.currentRev;
    return runCommit(() =>
      options.commit({
        mode: mode.value,
        sessionId: sessionId.value,
        form: options.form.value,
        base: baseRecord.value,
        baseRev: baseRev.value,
        resolutions,
        expectedRev,
      }),
    );
  }

  /** 放弃草稿（手动丢弃） */
  async function discard() {
    clearTimer();
    if (sessionId.value) {
      await draftStore.removeSession(options.kind, sessionId.value);
    }
    active.value = false;
    conflict.value = null;
  }

  /** 关闭弹窗但保留草稿（草稿已自动保存） */
  function close() {
    clearTimer();
    void persistNow();
    active.value = false;
    conflict.value = null;
  }

  return {
    mode,
    sessionId,
    conflict,
    submitting,
    saving,
    restoredAt,
    lastSavedAt,
    hasDraft: computed(() => Boolean(existingDraft.value)),
    beginCreate,
    beginEdit,
    restore,
    submitCommit,
    retryCommit,
    persistNow,
    discard,
    close,
  };
}
