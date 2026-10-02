import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { pairBoards, boardUsable } from '../utils/wood';
import { ConflictError, recordConflict, resolveGuardedMerge } from '../utils/conflict';
import { boardFormToRecord, FIELD_SPECS } from '../utils/forms';
import { postBus } from '../utils/bus';
import type { BoardPair, WoodBoard } from '../types/wood-board';
import type { BoardDraftForm } from '../types/draft';

export interface BoardCommitRequest {
  mode: 'create' | 'edit';
  /** edit=板材 id；create=本次登记会话的临时 id */
  sessionId: string;
  form: BoardDraftForm;
  /** 打开编辑时的正式档案快照（基线）；create 为 null */
  base: WoodBoard | null;
  /** 冲突重试：逐字段采用哪一方（未选字段不会通过核对） */
  resolutions?: Record<string, 'ours' | 'theirs'>;
  /** 冲突重试：上次核对到的对方版本号 */
  expectedRev?: number;
}

interface BoardState {
  boards: WoodBoard[];
  hydrated: boolean;
}

/** 板材与面板/底板配对（正式工序档案，提交带版本核对） */
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
    async hydrate() {
      this.boards = await db.boards.orderBy('boardNo').toArray();
      this.hydrated = true;
    },

    /**
     * 提交板材草稿到正式档案：
     * - create：直接新增（板材号各不相同，无自然键冲突）；
     * - edit：按打开时的 rev 核对，对方页签已提交时做字段级三向比对，
     *   确实冲突抛 ConflictError（事务回滚，正式档案与草稿均保留，可带选择重试）。
     */
    async commitBoard(req: BoardCommitRequest): Promise<WoodBoard> {
      const rec = boardFormToRecord(req.form) as Record<string, unknown> & {
        boardNo: string;
        guqinNo: string;
        part: WoodBoard['part'];
        species: WoodBoard['species'];
        dryYears: number;
        thicknessMm: number;
        grain: WoodBoard['grain'];
        defect: WoodBoard['defect'];
        receivedAt: string;
        remark: string;
      };
      const specs = FIELD_SPECS.board;
      let committed!: WoodBoard;

      await db.transaction('rw', db.boards, async () => {
        const now = new Date().toISOString();
        if (req.mode === 'create') {
          const board: WoodBoard = {
            id: uid('board'),
            boardNo: rec.boardNo as string,
            guqinNo: rec.guqinNo as string,
            part: rec.part,
            species: rec.species,
            dryYears: rec.dryYears as number,
            thicknessMm: rec.thicknessMm as number,
            grain: rec.grain,
            defect: rec.defect,
            receivedAt: rec.receivedAt as string,
            remark: (rec.remark as string) || undefined,
            rev: 1,
            updatedAt: now,
          };
          await db.boards.put(toPlain(board));
          committed = board;
          return;
        }

        const current = await db.boards.get(req.sessionId);
        if (!current) {
          throw new ConflictError(recordConflict('board', 'record-deleted', 0, '这块板材已被另一个页签删除，正式档案中不存在该记录'));
        }
        const base = req.base ?? current;
        const merged = resolveGuardedMerge('board', specs, base, current, rec, req.resolutions, req.expectedRev);

        const next: WoodBoard = {
          id: current.id,
          boardNo: merged.boardNo as string,
          guqinNo: merged.guqinNo as string,
          part: merged.part as WoodBoard['part'],
          species: merged.species as WoodBoard['species'],
          dryYears: merged.dryYears as number,
          thicknessMm: merged.thicknessMm as number,
          grain: merged.grain as WoodBoard['grain'],
          defect: merged.defect as WoodBoard['defect'],
          receivedAt: merged.receivedAt as string,
          remark: (merged.remark as string) || undefined,
          rev: current.rev + 1,
          updatedAt: now,
        };
        await db.boards.put(toPlain(next));
        committed = next;
      });

      this.boards = committed.rev === 1 ? [committed, ...this.boards] : this.boards.map((b) => (b.id === committed.id ? committed : b));
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
      return committed;
    },

    async removeBoard(id: string) {
      await db.boards.delete(id);
      this.boards = this.boards.filter((b) => b.id !== id);
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
    },
  },
});
