import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { toPlain } from '../utils/plain';
import { getTabId } from '../utils/tab';
import type { DraftKind, DraftPayload, ProcessDraft } from '../types/draft';

interface DraftState {
  /** 当前页签的全部草稿（正式档案与草稿分存，这里只放本页签的） */
  drafts: ProcessDraft[];
  hydrated: boolean;
}

function draftKey(kind: DraftKind, targetId: string): string {
  return `${getTabId()}:${kind}:${targetId}`;
}

/**
 * 工序草稿：每个页签各自一份，存于独立 drafts 表。
 * 正式档案（boards/chambers/lacquers/stringings）只在提交成功后才改动，
 * 因此写冲突核对失败时，正式档案原样不动，草稿仍在此表中，可修改后重试。
 */
export const useDraftStore = defineStore('draft', {
  state: (): DraftState => ({ drafts: [], hydrated: false }),

  getters: {
    byKey(state) {
      return (kind: DraftKind, targetId: string): ProcessDraft | undefined =>
        state.drafts.find((d) => d.id === draftKey(kind, targetId));
    },
    ofKind(state) {
      return (kind: DraftKind): ProcessDraft[] => state.drafts.filter((d) => d.kind === kind);
    },
    /** 本页签尚未提交的草稿数（顶栏异常提示用） */
    pendingCount(state): number {
      return state.drafts.length;
    },
  },

  actions: {
    async hydrate() {
      this.drafts = await db.drafts.where('tabId').equals(getTabId()).toArray();
      this.hydrated = true;
    },

    /**
     * 保存（自动保存）一条草稿。
     * 新建记录 targetId 用临时 id；resolveKey 用于提交时认领别页签抢先创建的同号正式记录。
     */
    async saveDraft(input: {
      kind: DraftKind;
      targetId: string;
      resolveKey: string;
      payload: DraftPayload;
      baseVersion: number;
      baseSnapshot: Record<string, unknown>;
      existed: boolean;
    }): Promise<ProcessDraft> {
      const now = new Date().toISOString();
      const existing = this.byKey(input.kind, input.targetId);
      const draft: ProcessDraft = {
        id: draftKey(input.kind, input.targetId),
        tabId: getTabId(),
        kind: input.kind,
        targetId: input.targetId,
        resolveKey: input.resolveKey,
        payload: toPlain(input.payload),
        baseVersion: input.baseVersion,
        baseSnapshot: toPlain(input.baseSnapshot),
        existed: input.existed,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await db.drafts.put(toPlain(draft));
      this.drafts = [...this.drafts.filter((d) => d.id !== draft.id), draft];
      return draft;
    },

    /** 仅更新草稿内容（保留打开时的版本与快照） */
    async updatePayload(target: { kind: DraftKind; targetId: string }, payload: DraftPayload): Promise<void> {
      const existing = this.byKey(target.kind, target.targetId);
      if (!existing) return;
      const next: ProcessDraft = { ...existing, payload: toPlain(payload), updatedAt: new Date().toISOString() };
      await db.drafts.put(toPlain(next));
      this.drafts = this.drafts.map((d) => (d.id === next.id ? next : d));
    },

    /** 提交成功后删除草稿（仅在正式档案写入成功后调用） */
    async removeDraft(kind: DraftKind, targetId: string): Promise<void> {
      const id = draftKey(kind, targetId);
      await db.drafts.delete(id);
      this.drafts = this.drafts.filter((d) => d.id !== id);
    },
  },
});
