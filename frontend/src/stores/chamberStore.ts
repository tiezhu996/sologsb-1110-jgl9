import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { PostPos, SoundChamber, ThicknessMark } from '../types/sound-chamber';
import type { ChamberDraftForm } from '../types/draft';
import { ConflictError, recordConflict, resolveGuardedMerge } from '../utils/conflict';
import { chamberFormToRecord, FIELD_SPECS } from '../utils/forms';
import { postBus } from '../utils/bus';

export interface ChamberCommitRequest {
  mode: 'create' | 'edit';
  /** edit=槽腹记录 id；create=本次登记会话的临时 id */
  sessionId: string;
  form: ChamberDraftForm;
  base: SoundChamber | null;
  resolutions?: Record<string, 'ours' | 'theirs'>;
  expectedRev?: number;
}

interface ChamberState {
  chambers: SoundChamber[];
  hydrated: boolean;
}

/** 槽腹尺寸与剖面派生值（正式工序档案，提交带版本核对） */
export const useChamberStore = defineStore('chamber', {
  state: (): ChamberState => ({ chambers: [], hydrated: false }),

  getters: {
    byGuqin(state) {
      return (guqinNo: string): SoundChamber | undefined => state.chambers.find((c) => c.guqinNo === guqinNo);
    },
    /** 三处厚度标注点，供 DimensionChart 绘制剖面标注 */
    marksOf(state) {
      return (guqinNo: string): ThicknessMark[] => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return [];
        return [
          { key: 'nayinThickness', label: '纳音', value: chamber.nayinThickness },
          { key: 'longchiThickness', label: '龙池', value: chamber.longchiThickness },
          { key: 'fengzhaoThickness', label: '凤沼', value: chamber.fengzhaoThickness },
        ];
      };
    },
    /** 三处厚度极差（mm），差值过大说明掏膛不均 */
    thicknessSpread(state) {
      return (guqinNo: string): number => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return 0;
        const list = [chamber.nayinThickness, chamber.longchiThickness, chamber.fengzhaoThickness];
        return Number((Math.max(...list) - Math.min(...list)).toFixed(1));
      };
    },
    /** 深径比：槽腹深度 / 面板平均厚度 */
    depthRatio(state) {
      return (guqinNo: string): number => {
        const chamber = state.chambers.find((c) => c.guqinNo === guqinNo);
        if (!chamber) return 0;
        const avg = (chamber.nayinThickness + chamber.longchiThickness + chamber.fengzhaoThickness) / 3;
        return avg > 0 ? Number((chamber.chamberDepth / avg).toFixed(2)) : 0;
      };
    },
  },

  actions: {
    async hydrate() {
      this.chambers = await db.chambers.orderBy('carvedAt').reverse().toArray();
      this.hydrated = true;
    },

    /**
     * 提交槽腹草稿：每张琴一份槽腹记录。
     * - create：该琴号已有正式记录时，说明另一页签抢先登记，按琴号占用冲突处理；
     * - edit：按 rev 三向核对；改填的琴号已被别的记录占用同样列出冲突；
     * - 正式记录被删时抛 record-deleted。
     */
    async commitChamber(req: ChamberCommitRequest): Promise<SoundChamber> {
      const rec = chamberFormToRecord(req.form);
      const specs = FIELD_SPECS.chamber;
      let committed!: SoundChamber;

      await db.transaction('rw', db.chambers, async () => {
        const now = new Date().toISOString();
        if (req.mode === 'create') {
          const taken = await db.chambers.where('guqinNo').equals(rec.guqinNo as string).first();
          if (taken) {
            throw new ConflictError(
              recordConflict('chamber', 'guqin-taken', taken.rev, `琴号 ${taken.guqinNo} 已有槽腹档案（另一页签刚登记），请改为编辑该记录`),
            );
          }
          const chamber: SoundChamber = {
            id: uid('chamber'),
            guqinNo: rec.guqinNo as string,
            nayinThickness: rec.nayinThickness as number,
            longchiThickness: rec.longchiThickness as number,
            fengzhaoThickness: rec.fengzhaoThickness as number,
            chamberDepth: rec.chamberDepth as number,
            postPos: rec.postPos as PostPos,
            poolSize: rec.poolSize as string,
            carvedAt: rec.carvedAt as string,
            carver: rec.carver as string,
            remark: (rec.remark as string) || undefined,
            rev: 1,
            updatedAt: now,
          };
          await db.chambers.put(toPlain(chamber));
          committed = chamber;
          return;
        }

        const current = await db.chambers.get(req.sessionId);
        if (!current) {
          throw new ConflictError(recordConflict('chamber', 'record-deleted', 0, '这份槽腹档案已被另一个页签删除'));
        }
        const taken = await db.chambers.where('guqinNo').equals(rec.guqinNo as string).first();
        if (taken && taken.id !== current.id) {
          throw new ConflictError(
            recordConflict('chamber', 'guqin-taken', taken.rev, `琴号 ${taken.guqinNo} 已被另一份槽腹档案占用，无法改填该琴号`),
          );
        }
        const base = req.base ?? current;
        const merged = resolveGuardedMerge('chamber', specs, base, current, rec, req.resolutions, req.expectedRev);

        const next: SoundChamber = {
          id: current.id,
          guqinNo: merged.guqinNo as string,
          nayinThickness: merged.nayinThickness as number,
          longchiThickness: merged.longchiThickness as number,
          fengzhaoThickness: merged.fengzhaoThickness as number,
          chamberDepth: merged.chamberDepth as number,
          postPos: merged.postPos as PostPos,
          poolSize: merged.poolSize as string,
          carvedAt: merged.carvedAt as string,
          carver: merged.carver as string,
          remark: (merged.remark as string) || undefined,
          rev: current.rev + 1,
          updatedAt: now,
        };
        await db.chambers.put(toPlain(next));
        committed = next;
      });

      this.chambers = committed.rev === 1 ? [committed, ...this.chambers] : this.chambers.map((c) => (c.id === committed.id ? committed : c));
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
      return committed;
    },

    async removeChamber(id: string) {
      await db.chambers.delete(id);
      this.chambers = this.chambers.filter((c) => c.id !== id);
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
    },
  },
});
