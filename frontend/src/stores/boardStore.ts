import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { subscribeTable } from '../utils/live';
import { pairBoards, boardUsable } from '../utils/wood';
import { RECORD_FIELDS } from '../utils/records';
import { checkCommit, resolveMerged, CommitFailedError, unresolvedConflicts } from '../utils/concurrency';
import type { BoardPart, BoardPair, WoodBoard, WoodDefect, WoodGrain, WoodSpecies } from '../types/wood-board';
import type { CommitCheck, DraftPayload, ProcessDraft } from '../types/draft';

export interface BoardInput {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt?: string;
  remark?: string;
}

interface BoardState {
  /** 正式板材档案（liveQuery 订阅，跨页签提交后自动同步） */
  boards: WoodBoard[];
  hydrated: boolean;
}

/** 板材与面板/底板配对（正式档案），草稿不经此 store */
export const useBoardStore = defineStore('board', {
  state: (): BoardState => ({ boards: [], hydrated: false }),

  getters: {
    /** 面板与底板按琴号配对并回显含水率 */
    pairs(state): BoardPair[] {
      return pairBoards(state.boards);
    },
    /** 可用板材数（无裂纹且阴干达标） */
    usableCount(state): number {
      return state.boards.filter(boardUsable).length;
    },
    guqinNos(state): string[] {
      return Array.from(new Set(state.boards.map((b) => b.guqinNo))).sort();
    },
    boardsOf(state) {
      return (guqinNo: string): WoodBoard[] => state.boards.filter((b) => b.guqinNo === guqinNo);
    },
  },

  actions: {
    hydrate() {
      const sub = subscribeTable(
        () => db.boards.orderBy('boardNo').toArray(),
        (rows) => {
          this.boards = rows;
        },
      );
      this.hydrated = true;
      return sub;
    },

    /** 提交前核对：草稿 vs 正式档案（按 id 找；新建草稿按 琴号+部位 认领抢先提交的记录） */
    prepareCommit(draft: ProcessDraft): { check: CommitCheck; current: WoodBoard | undefined } {
      const current = this.findTarget(draft);
      const base = draft.existed ? draft.baseSnapshot : null;
      const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
      const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.board);
      return { check, current };
    },

    /** 在当前正式档案中定位草稿目标：编辑按 id，新建按琴号+部位认领 */
    findTarget(draft: ProcessDraft): WoodBoard | undefined {
      const byId = this.boards.find((b) => b.id === draft.targetId);
      if (byId || draft.existed) return byId;
      const resolveKey = boardResolveKey(draft.payload as unknown as BoardInput);
      return this.boards.find((b) => boardResolveKey(b) === resolveKey);
    },

    /**
     * 按乐观锁提交草稿：事务内再次核对正式档案版本，
     * 有未处理冲突或档案已被删时回滚（正式档案不动、草稿保留，可重试）。
     */
    async commitDraft(draft: ProcessDraft, resolved: Record<string, 'mine' | 'theirs'> = {}): Promise<WoodBoard> {
      const payload = draft.payload as unknown as BoardInput;
      const buildRow = (fields: DraftPayload, version: number, id?: string): WoodBoard => ({
        id: id ?? draft.targetId,
        boardNo: String(fields.boardNo ?? '').trim(),
        guqinNo: String(fields.guqinNo ?? '').trim(),
        part: fields.part as BoardPart,
        species: fields.species as WoodSpecies,
        dryYears: Number(fields.dryYears) || 0,
        thicknessMm: Number(fields.thicknessMm) || 0,
        grain: fields.grain as WoodGrain,
        defect: fields.defect as WoodDefect,
        receivedAt: String(fields.receivedAt ?? new Date().toISOString()),
        remark: fields.remark ? String(fields.remark) : undefined,
        version,
      });

      return db.transaction('rw', db.boards, async () => {
        const all = await db.boards.toArray();
        const byId = all.find((b) => b.id === draft.targetId);
        const byKey = !draft.existed
          ? all.find((b) => boardResolveKey(b) === boardResolveKey(payload))
          : undefined;
        const current = byId ?? byKey;

        const base = draft.existed ? draft.baseSnapshot : null;
        const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
        const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.board);

        if (unresolvedConflicts(check, resolved).length) {
          throw new CommitFailedError(check, 'conflict');
        }
        // 编辑期间记录被另一页签删除：不自动重建，中止提交保留草稿
        if (draft.existed && !current) {
          throw new CommitFailedError(check, 'deleted');
        }

        const fields = resolveMerged(draft.payload, theirs, check, resolved);
        const nextVersion = current ? (current.version ?? 1) + 1 : 1;
        const row = buildRow(fields, nextVersion, current?.id);
        await db.boards.put(toPlain(row));
        return row;
      });
    },

    async removeBoard(id: string) {
      await db.boards.delete(id);
      // liveQuery 会同步 this.boards，无需手动剔除
    },
  },
});

/** 新建板材草稿的临时 id（正式 id 在提交成功、确认没有同号同部位记录后落定） */
export function newBoardDraftId(): string {
  return uid('board-new');
}

/** 板材认领键：同一琴号同一部位视为同一张板 */
export function boardResolveKey(input: Pick<BoardInput, 'guqinNo' | 'part'>): string {
  return `${input.guqinNo.trim()}:${input.part}`;
}
