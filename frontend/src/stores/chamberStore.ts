import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { subscribeTable } from '../utils/live';
import { RECORD_FIELDS } from '../utils/records';
import { checkCommit, resolveMerged, CommitFailedError, unresolvedConflicts } from '../utils/concurrency';
import type { PostPos, SoundChamber, ThicknessMark } from '../types/sound-chamber';
import type { CommitCheck, DraftPayload, ProcessDraft } from '../types/draft';

export interface ChamberInput {
  guqinNo: string;
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
  carvedAt?: string;
  carver: string;
  remark?: string;
}

interface ChamberState {
  /** 正式槽腹档案（liveQuery 订阅，跨页签提交后自动同步） */
  chambers: SoundChamber[];
  hydrated: boolean;
}

/** 认领键：每张琴一份槽腹记录 */
export function chamberResolveKey(guqinNo: string): string {
  return guqinNo.trim();
}

/** 槽腹尺寸与剖面派生值（正式档案） */
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
    hydrate() {
      const sub = subscribeTable(
        () => db.chambers.orderBy('carvedAt').reverse().toArray(),
        (rows) => {
          this.chambers = rows;
        },
      );
      this.hydrated = true;
      return sub;
    },

    /** 定位草稿目标：编辑按 id，新建按琴号认领（一琴一档） */
    findTarget(draft: ProcessDraft): SoundChamber | undefined {
      const byId = this.chambers.find((c) => c.id === draft.targetId);
      if (byId || draft.existed) return byId;
      const guqinNo = chamberResolveKey(String(draft.payload.guqinNo ?? ''));
      return this.chambers.find((c) => chamberResolveKey(c.guqinNo) === guqinNo);
    },

    prepareCommit(draft: ProcessDraft): { check: CommitCheck; current: SoundChamber | undefined } {
      const current = this.findTarget(draft);
      const base = draft.existed ? draft.baseSnapshot : null;
      const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
      const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.chamber);
      return { check, current };
    },

    /** 乐观锁提交：冲突或档案被删时回滚，正式档案不动、草稿保留可重试 */
    async commitDraft(
      draft: ProcessDraft,
      resolved: Record<string, 'mine' | 'theirs'> = {},
    ): Promise<SoundChamber> {
      const payload = draft.payload as unknown as ChamberInput;
      const buildRow = (fields: DraftPayload, version: number, id?: string, carvedAt?: string): SoundChamber => ({
        id: id ?? draft.targetId,
        guqinNo: String(fields.guqinNo ?? '').trim(),
        nayinThickness: Number(fields.nayinThickness) || 0,
        longchiThickness: Number(fields.longchiThickness) || 0,
        fengzhaoThickness: Number(fields.fengzhaoThickness) || 0,
        chamberDepth: Number(fields.chamberDepth) || 0,
        postPos: fields.postPos as PostPos,
        poolSize: String(fields.poolSize ?? '').trim(),
        carvedAt: carvedAt ?? String(fields.carvedAt ?? new Date().toISOString()),
        carver: String(fields.carver ?? '').trim(),
        remark: fields.remark ? String(fields.remark) : undefined,
        version,
      });

      return db.transaction('rw', db.chambers, async () => {
        const all = await db.chambers.toArray();
        const byId = all.find((c) => c.id === draft.targetId);
        const byKey = !draft.existed
          ? all.find((c) => chamberResolveKey(c.guqinNo) === chamberResolveKey(String(payload.guqinNo)))
          : undefined;
        const current = byId ?? byKey;

        const base = draft.existed ? draft.baseSnapshot : null;
        const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
        const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.chamber);

        if (unresolvedConflicts(check, resolved).length) {
          throw new CommitFailedError(check, 'conflict');
        }
        if (draft.existed && !current) {
          throw new CommitFailedError(check, 'deleted');
        }

        const fields = resolveMerged(draft.payload, theirs, check, resolved);
        const nextVersion = current ? (current.version ?? 1) + 1 : 1;
        const row = buildRow(fields, nextVersion, current?.id, current?.carvedAt);
        await db.chambers.put(toPlain(row));
        return row;
      });
    },

    async removeChamber(id: string) {
      await db.chambers.delete(id);
    },
  },
});

/** 新建槽腹草稿的临时 id */
export function newChamberDraftId(): string {
  return uid('chamber-new');
}
