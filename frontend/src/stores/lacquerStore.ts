import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { subscribeTable } from '../utils/live';
import { cumulativeThickness, nextSeq, sortLayers } from '../utils/layer';
import { RECORD_FIELDS } from '../utils/records';
import { checkCommit, resolveMerged, CommitFailedError, unresolvedConflicts } from '../utils/concurrency';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { CommitCheck, DraftPayload, ProcessDraft } from '../types/draft';

export interface LacquerInput {
  guqinNo: string;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt?: string;
  operator: string;
  remark?: string;
}

interface LacquerState {
  /** 正式髹漆档案（liveQuery 订阅，跨页签提交后自动同步） */
  layers: LacquerLayer[];
  hydrated: boolean;
}

/** 髹漆遍次与累计厚度（正式档案）；追加草稿在提交时才分配遍次 */
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
    /** 荫房温湿度超窗口的遍次数量 */
    outOfRangeCount(state): number {
      return state.layers.filter((l) => !(l.curingTemp >= 20 && l.curingTemp <= 30 && l.curingHumidity >= 70 && l.curingHumidity <= 85)).length;
    },
  },

  actions: {
    hydrate() {
      const sub = subscribeTable(
        () => db.lacquers.toArray(),
        (rows) => {
          this.layers = rows;
        },
      );
      this.hydrated = true;
      return sub;
    },

    /** 遍次编辑按 id 定位；追加是新记录，不与别页签的追加撞档 */
    findTarget(draft: ProcessDraft): LacquerLayer | undefined {
      return this.layers.find((l) => l.id === draft.targetId);
    },

    prepareCommit(draft: ProcessDraft): { check: CommitCheck; current: LacquerLayer | undefined } {
      const current = this.findTarget(draft);
      const base = draft.existed ? draft.baseSnapshot : null;
      const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
      const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.lacquer);
      return { check, current };
    },

    /**
     * 乐观锁提交。
     * - 编辑某遍：三方核对，冲突需逐字段确认，档案被删则回滚；
     * - 追加新遍：提交时在事务内按正式档案现状分配 seq（两页签各得一遍，不互相盖掉），
     *   并重算该琴全部遍次的累计厚度。
     */
    async commitDraft(
      draft: ProcessDraft,
      resolved: Record<string, 'mine' | 'theirs'> = {},
    ): Promise<LacquerLayer> {
      return db.transaction('rw', db.lacquers, async () => {
        const all = await db.lacquers.toArray();
        const current = draft.existed ? all.find((l) => l.id === draft.targetId) : undefined;

        const base = draft.existed ? draft.baseSnapshot : null;
        const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
        const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.lacquer);

        if (unresolvedConflicts(check, resolved).length) {
          throw new CommitFailedError(check, 'conflict');
        }
        if (draft.existed && !current) {
          throw new CommitFailedError(check, 'deleted');
        }

        const fields = resolveMerged(draft.payload, theirs, check, resolved) as DraftPayload & LacquerInput;
        const guqinNo = String(fields.guqinNo ?? '').trim();
        const baseRow: LacquerLayer = {
          id: current?.id ?? draft.targetId,
          guqinNo,
          seq: current?.seq ?? 0,
          mixRatio: String(fields.mixRatio ?? ''),
          curingTemp: Number(fields.curingTemp) || 0,
          curingHumidity: Number(fields.curingHumidity) || 0,
          polishGrit: Number(fields.polishGrit) || 0,
          layerThickness: Number(fields.layerThickness) || 0,
          totalThickness: current?.totalThickness ?? 0,
          appliedAt: String(fields.appliedAt ?? new Date().toISOString()),
          operator: String(fields.operator ?? '').trim(),
          remark: fields.remark ? String(fields.remark) : undefined,
          version: current ? (current.version ?? 1) + 1 : 1,
        };

        let siblings = all.filter((l) => l.guqinNo === guqinNo);
        if (current) {
          siblings = siblings.map((l) => (l.id === current.id ? baseRow : l));
        } else {
          baseRow.seq = nextSeq(siblings);
          siblings = [...siblings, baseRow];
        }
        const ordered = sortLayers(siblings);
        for (const layer of ordered) {
          const row: LacquerLayer = { ...layer, totalThickness: cumulativeThickness(ordered, layer.seq) };
          await db.lacquers.put(toPlain(row));
        }
        return { ...baseRow, totalThickness: cumulativeThickness(ordered, baseRow.seq) };
      });
    },

    /** 删除某遍并重算该琴累计厚度（正式档案操作，不经草稿） */
    async removeLayer(id: string) {
      await db.transaction('rw', db.lacquers, async () => {
        const target = await db.lacquers.get(id);
        await db.lacquers.delete(id);
        if (!target) return;
        const siblings = sortLayers((await db.lacquers.toArray()).filter((l) => l.guqinNo === target.guqinNo));
        for (const layer of siblings) {
          await db.lacquers.put(toPlain({ ...layer, totalThickness: cumulativeThickness(siblings, layer.seq) }));
        }
      });
    },
  },
});

/** 追加髹漆草稿的临时 id（每遍一条新正式记录） */
export function newLacquerDraftId(): string {
  return uid('layer-new');
}
