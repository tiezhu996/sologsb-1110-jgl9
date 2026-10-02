import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { getTabId } from '../utils/tab';
import { toPlain } from '../utils/plain';
import type { DraftKind, DraftMode, DraftPayload, ProcessDraft } from '../types/draft';

interface DraftState {
  drafts: ProcessDraft[];
  hydrated: boolean;
}

export interface DraftSnapshot {
  kind: DraftKind;
  mode: DraftMode;
  /** edit=正式档案 id；create=本次登记弹窗的临时会话 id */
  sessionId: string;
  guqinNo: string;
  payload: DraftPayload;
  /** 打开编辑时的正式档案快照；create 为 null */
  baseRecord: ProcessDraft['baseRecord'];
  baseRev: number;
}

/**
 * 工序草稿仓：草稿只存 drafts 表并按 tabId 隔离，
 * 与 boards/chambers/lacquers/stringings 四张正式工序档案表完全分开。
 */
export const useDraftStore = defineStore('draft', {
  state: (): DraftState => ({ drafts: [], hydrated: false }),

  getters: {
    /** 当前页签的全部未提交草稿（最近更新在前） */
    tabDrafts(state): ProcessDraft[] {
      const tabId = getTabId();
      return state.drafts
        .filter((d) => d.tabId === tabId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    /** 当前页签草稿数（顶栏角标） */
    tabCount(): number {
      return this.tabDrafts.length;
    },
  },

  actions: {
    async hydrate() {
      this.drafts = await db.drafts.where('tabId').equals(getTabId()).toArray();
      this.hydrated = true;
    },

    /** 自动保存：同一会话覆盖同一条草稿 */
    async save(snapshot: DraftSnapshot): Promise<ProcessDraft> {
      const now = new Date().toISOString();
      const tabId = getTabId();
      const id = `${tabId}:${snapshot.kind}:${snapshot.sessionId}`;
      const existed = this.drafts.find((d) => d.id === id);
      const draft: ProcessDraft = {
        id,
        tabId,
        kind: snapshot.kind,
        mode: snapshot.mode,
        sessionId: snapshot.sessionId,
        targetId: snapshot.mode === 'edit' ? snapshot.sessionId : '',
        guqinNo: snapshot.guqinNo.trim(),
        payload: toPlain(snapshot.payload),
        baseRecord: snapshot.baseRecord ? toPlain(snapshot.baseRecord) : null,
        baseRev: snapshot.baseRev,
        createdAt: existed?.createdAt ?? now,
        updatedAt: now,
      };
      await db.drafts.put(toPlain(draft));
      this.drafts = [draft, ...this.drafts.filter((d) => d.id !== id)];
      return draft;
    },

    async remove(id: string) {
      await db.drafts.delete(id);
      this.drafts = this.drafts.filter((d) => d.id !== id);
    },

    /** 提交成功后删除对应会话的草稿 */
    async removeSession(kind: DraftKind, sessionId: string) {
      const id = `${getTabId()}:${kind}:${sessionId}`;
      await this.remove(id);
    },

    async get(id: string): Promise<ProcessDraft | undefined> {
      return db.drafts.get(id);
    },
  },
});
