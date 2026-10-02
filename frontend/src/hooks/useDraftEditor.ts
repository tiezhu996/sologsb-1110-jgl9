import { computed, ref } from 'vue';
import { useDraftStore } from '../stores/draftStore';
import { snapshotOfRecord } from '../utils/records';
import { debounce } from '../utils/timing';
import type { CommitCheck, DraftKind, DraftPayload, ProcessDraft } from '../types/draft';

/** 提交上下文：核对结果与双方字段值，供冲突对话框展示 */
export interface CommitContext {
  check: CommitCheck;
  draft: ProcessDraft;
  /** 字段中文标签 */
  labels: Record<string, string>;
}

interface UseDraftEditorOptions {
  kind: DraftKind;
  /** 从正式档案 id 查到记录（打开编辑取快照用；新建返回 undefined） */
  getRecord: (id: string) => { version?: number } | undefined;
}

/**
 * 工序编辑草稿的通用流程：
 * 打开时记录正式档案版本与字段快照 → 编辑内容自动存入本页签草稿 →
 * 提交时三方核对，冲突交由页面弹窗逐字段确认 → 正式档案写入成功后才删草稿。
 * 任何失败都不改正式档案，草稿原样保留、可修改后重试。
 */
export function useDraftEditor(options: UseDraftEditorOptions) {
  const draftStore = useDraftStore();

  /** 编辑弹窗是否打开 */
  const dialogVisible = ref(false);
  /** 编辑目标草稿 id（新建为临时 id） */
  const targetId = ref('');
  /** 打开时正式档案是否存在 */
  const existed = ref(false);
  /** 当前目标是否已有本页签草稿 */
  const hasDraft = ref(false);
  const submitting = ref(false);
  const lastError = ref('');
  /** 非空表示存在双方冲突，等待档案员逐字段选择 */
  const commitContext = ref<CommitContext | null>(null);

  /**
   * 开始一轮编辑，返回应填入表单的字段。
   * @param id 目标 id（新建传临时 id）
   * @param alreadyExisted 是否编辑已有正式记录
   * @param initialPayload 新建初始 / 编辑当前字段
   * @param draft 继续此前保存的草稿时传入（沿用其版本与快照）
   */
  function begin(
    id: string,
    alreadyExisted: boolean,
    initialPayload: object,
    draft?: ProcessDraft,
  ): DraftPayload {
    targetId.value = id;
    existed.value = draft?.existed ?? alreadyExisted;
    hasDraft.value = Boolean(draft);
    commitContext.value = null;
    lastError.value = '';
    dialogVisible.value = true;
    return draft ? (JSON.parse(JSON.stringify(draft.payload)) as DraftPayload) : (initialPayload as DraftPayload);
  }

  /** 确保草稿已落库，返回草稿（提交前先保存，保证失败可重试） */
  async function ensureDraft(payload: DraftPayload): Promise<ProcessDraft> {
    const existing = draftStore.byKey(options.kind, targetId.value);
    if (existing) {
      await draftStore.updatePayload({ kind: options.kind, targetId: targetId.value }, payload);
      return draftStore.byKey(options.kind, targetId.value)!;
    }
    const record = options.getRecord(targetId.value);
    const { snapshot, version, existed: wasExisted } = snapshotOfRecord(options.kind, record);
    await draftStore.saveDraft({
      kind: options.kind,
      targetId: targetId.value,
      resolveKey: '',
      payload,
      baseVersion: version,
      baseSnapshot: snapshot,
      existed: wasExisted,
    });
    existed.value = wasExisted;
    hasDraft.value = true;
    return draftStore.byKey(options.kind, targetId.value)!;
  }

  /** 自动保存（防抖）：只写 drafts 表，不碰正式档案 */
  const persist = debounce((payload: DraftPayload) => {
    // 关闭弹窗或放弃草稿后，迟到的一次按键写入不应再把草稿建回来
    if (!dialogVisible.value) return;
    void ensureDraft(payload);
  }, 350);

  /**
   * 提交。prepare 做三方核对；无冲突则 commit 执行乐观锁写入并删草稿。
   * 有冲突时设置 commitContext，返回 'conflict'，正式档案与草稿均不变。
   */
  async function runCommit(
    prepare: (draft: ProcessDraft) => { check: CommitCheck },
    commit: (draft: ProcessDraft, resolved: Record<string, 'mine' | 'theirs'>) => Promise<unknown>,
    payload: DraftPayload,
    labels: Record<string, string>,
  ): Promise<'committed' | 'conflict'> {
    submitting.value = true;
    lastError.value = '';
    try {
      const draft = await ensureDraft(payload);
      const { check } = prepare(draft);
      if (check.conflicts.length) {
        commitContext.value = { check, draft, labels };
        return 'conflict';
      }
      await commit(draft, {});
      await draftStore.removeDraft(options.kind, targetId.value);
      hasDraft.value = false;
      commitContext.value = null;
      dialogVisible.value = false;
      return 'committed';
    } catch (error) {
      lastError.value = (error as Error).message;
      throw error;
    } finally {
      submitting.value = false;
    }
  }

  /** 冲突弹窗逐字段选择后重试提交；弹窗期间对方再次提交会刷新冲突列表 */
  async function resolveAndCommit(
    prepare: (draft: ProcessDraft) => { check: CommitCheck },
    commit: (draft: ProcessDraft, resolved: Record<string, 'mine' | 'theirs'>) => Promise<unknown>,
    resolved: Record<string, 'mine' | 'theirs'>,
    payload: DraftPayload,
  ): Promise<'committed' | 'conflict'> {
    const context = commitContext.value;
    if (!context) return 'committed';
    submitting.value = true;
    lastError.value = '';
    try {
      await draftStore.updatePayload({ kind: options.kind, targetId: targetId.value }, payload);
      const draft0 = draftStore.byKey(options.kind, targetId.value);
      if (!draft0) throw new Error('草稿已丢失，无法提交');
      try {
        await commit(draft0, resolved);
      } catch (error) {
        const e = error as { check?: CommitCheck };
        if (e.check) {
          commitContext.value = { check: e.check, draft: draft0, labels: context.labels };
          return 'conflict';
        }
        // 弹窗期间情况变化（如冲突已被对方消解）：重新核对一次
        const refreshed = draftStore.byKey(options.kind, targetId.value)!;
        const { check } = prepare(refreshed);
        if (check.conflicts.length) {
          commitContext.value = { check, draft: refreshed, labels: context.labels };
          return 'conflict';
        }
        lastError.value = (error as Error).message;
        throw error;
      }
      await draftStore.removeDraft(options.kind, targetId.value);
      hasDraft.value = false;
      commitContext.value = null;
      dialogVisible.value = false;
      return 'committed';
    } finally {
      submitting.value = false;
    }
  }

  /** 放弃并删除本草稿（档案员显式操作） */
  async function discard(): Promise<void> {
    persist.cancel();
    await draftStore.removeDraft(options.kind, targetId.value);
    hasDraft.value = false;
    commitContext.value = null;
    dialogVisible.value = false;
  }

  /** 关闭编辑弹窗但保留草稿（已自动保存，不会丢） */
  function close(): void {
    persist.cancel();
    dialogVisible.value = false;
  }

  /** 关闭冲突弹窗：不提交也不删草稿，稍后可继续编辑重试 */
  function cancelCommitDialog(): void {
    commitContext.value = null;
  }

  return {
    dialogVisible,
    targetId,
    existed,
    hasDraft,
    submitting,
    lastError,
    commitContext,
    begin,
    persist,
    close,
    runCommit,
    resolveAndCommit,
    discard,
    cancelCommitDialog,
    pendingDrafts: computed(() => draftStore.ofKind(options.kind)),
  };
}
