import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { cumulativeThickness, nextSeq, sortLayers } from '../utils/layer';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { LacquerDraftForm } from '../types/draft';
import { ConflictError, recordConflict, resolveGuardedMerge } from '../utils/conflict';
import { lacquerFormToRecord, FIELD_SPECS } from '../utils/forms';
import { postBus } from '../utils/bus';

export interface LacquerCommitRequest {
  mode: 'create' | 'edit';
  /** edit=该遍记录 id；create=本次追加会话的临时 id */
  sessionId: string;
  form: LacquerDraftForm;
  base: LacquerLayer | null;
  resolutions?: Record<string, 'ours' | 'theirs'>;
  expectedRev?: number;
}

interface LacquerState {
  layers: LacquerLayer[];
  hydrated: boolean;
}

/** 髹漆遍次与累计厚度（正式工序档案，提交带版本核对） */
export const useLacquerStore = defineStore('lacquer', {
  state: (): LacquerState => ({ layers: [], hydrated: false }),

  getters: {
    layersOf(state) {
      return (guqinNo: string): LacquerLayer[] => sortLayers(state.layers.filter((l) => l.guqinNo === guqinNo));
    },
    /** 该琴当前累计厚度（mm） */
    totalOf(state) {
      return (guqinNo: string): number => cumulativeThickness(state.layers.filter((l) => l.guqinNo === guqinNo));
    },
    guqinNos(state): string[] {
      return Array.from(new Set(state.layers.map((l) => l.guqinNo))).sort();
    },
    /** 荫房温湿度超窗口的遍次数量（只统计正式档案） */
    outOfRangeCount(state): number {
      return state.layers.filter((l) => !(l.curingTemp >= 20 && l.curingTemp <= 30 && l.curingHumidity >= 70 && l.curingHumidity <= 85)).length;
    },
  },

  actions: {
    async hydrate() {
      this.layers = await db.lacquers.toArray();
      this.hydrated = true;
    },

    /** 按正式档案重算同琴号各遍累计厚度并落库，返回该琴全部遍次 */
    async persistSiblings(layers: LacquerLayer[]): Promise<LacquerLayer[]> {
      const sorted = sortLayers(layers);
      const withTotals = sorted.map((item) => ({
        ...item,
        totalThickness: cumulativeThickness(sorted, item.seq),
      }));
      for (const item of withTotals) {
        await db.lacquers.put(toPlain(item));
      }
      return withTotals;
    },

    /**
     * 提交髹漆草稿：
     * - create：遍次号在事务内按正式档案当前最大值 +1（两个页签同时追加不会串遍次）；
     * - edit：按 rev 三向核对；若改了琴号导致遍次重复，提示琴号冲突；
     * - 提交后统一重算受影响琴号的累计厚度。
     */
    async commitLayer(req: LacquerCommitRequest): Promise<LacquerLayer> {
      const rec = lacquerFormToRecord(req.form);
      const specs = FIELD_SPECS.lacquer;
      const guqinNo = rec.guqinNo as string;
      let committed!: LacquerLayer;
      let affectedGuqin = guqinNo;

      await db.transaction('rw', db.lacquers, async () => {
        const now = new Date().toISOString();
        if (req.mode === 'create') {
          const siblings = await db.lacquers.where('guqinNo').equals(guqinNo).toArray();
          const layer: LacquerLayer = {
            id: uid('layer'),
            guqinNo,
            seq: nextSeq(siblings),
            mixRatio: rec.mixRatio as string,
            curingTemp: rec.curingTemp as number,
            curingHumidity: rec.curingHumidity as number,
            polishGrit: rec.polishGrit as number,
            layerThickness: rec.layerThickness as number,
            totalThickness: 0,
            appliedAt: rec.appliedAt as string,
            operator: rec.operator as string,
            remark: (rec.remark as string) || undefined,
            rev: 1,
            updatedAt: now,
          };
          await db.lacquers.put(toPlain(layer));
          committed = layer;
          return;
        }

        const current = await db.lacquers.get(req.sessionId);
        if (!current) {
          throw new ConflictError(recordConflict('lacquer', 'record-deleted', 0, '这遍髹漆记录已被另一个页签删除'));
        }
        const seqTaken = await db.lacquers.where('guqinNo').equals(guqinNo).filter((l) => l.seq === current.seq && l.id !== current.id).first();
        if (seqTaken) {
          throw new ConflictError(recordConflict('lacquer', 'guqin-taken', current.rev, `琴号 ${guqinNo} 已有第 ${current.seq} 遍，改填琴号会重复遍次`));
        }
        const base = req.base ?? current;
        const merged = resolveGuardedMerge('lacquer', specs, base, current, rec, req.resolutions, req.expectedRev);

        committed = {
          id: current.id,
          guqinNo,
          seq: current.seq,
          mixRatio: merged.mixRatio as string,
          curingTemp: merged.curingTemp as number,
          curingHumidity: merged.curingHumidity as number,
          polishGrit: merged.polishGrit as number,
          layerThickness: merged.layerThickness as number,
          totalThickness: current.totalThickness,
          appliedAt: merged.appliedAt as string,
          operator: merged.operator as string,
          remark: (merged.remark as string) || undefined,
          rev: current.rev + 1,
          updatedAt: now,
        };
        await db.lacquers.put(toPlain(committed));
        // 改填琴号时旧琴号的累计厚度也要重算
        affectedGuqin = current.guqinNo === guqinNo ? guqinNo : `${current.guqinNo}|${guqinNo}`;
      });

      // 重算受影响琴号（可能含旧、新两个琴号）各遍累计厚度
      const nos = affectedGuqin.split('|');
      for (const no of nos) {
        const siblings = await db.lacquers.where('guqinNo').equals(no).toArray();
        await this.persistSiblings(siblings);
      }
      // 累计厚度为正式档案派生值，直接以库内最新数据刷新内存态，避免漏掉对方页签刚追加的遍次
      this.layers = await db.lacquers.toArray();
      const finalLayer = (await db.lacquers.get(committed.id)) ?? committed;
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
      return finalLayer;
    },

    async removeLayer(id: string) {
      const current = this.layers.find((l) => l.id === id) ?? (await db.lacquers.get(id));
      await db.lacquers.delete(id);
      if (current) {
        const siblings = await db.lacquers.where('guqinNo').equals(current.guqinNo).toArray();
        await this.persistSiblings(siblings);
      }
      this.layers = await db.lacquers.toArray();
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
    },
  },
});
