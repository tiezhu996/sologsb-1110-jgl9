import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { StringDefect, StringType, Stringing, ToneVersion } from '../types/stringing';
import type { StringingDraftForm } from '../types/draft';
import { ConflictError, recordConflict, resolveGuardedMerge } from '../utils/conflict';
import { stringingFormToRecord, FIELD_SPECS } from '../utils/forms';
import { postBus } from '../utils/bus';

export interface StringingCommitRequest {
  mode: 'create' | 'edit';
  /** edit=上弦记录 id；create=本次登记会话的临时 id */
  sessionId: string;
  form: StringingDraftForm;
  base: Stringing | null;
  resolutions?: Record<string, 'ours' | 'theirs'>;
  expectedRev?: number;
}

interface StringingState {
  stringings: Stringing[];
  hydrated: boolean;
}

/** 上弦与文字评语（纯文本，不做音频处理；正式档案提交带版本核对） */
export const useStringingStore = defineStore('stringing', {
  state: (): StringingState => ({ stringings: [], hydrated: false }),

  getters: {
    byGuqin(state) {
      return (guqinNo: string): Stringing | undefined => state.stringings.find((s) => s.guqinNo === guqinNo);
    },
    /** 三段评语 + 九德的文字检索（只检索正式档案） */
    search(state) {
      return (keyword: string): Stringing[] => {
        const kw = keyword.trim().toLowerCase();
        if (!kw) return state.stringings;
        return state.stringings.filter((s) =>
          [s.guqinNo, s.sanNote, s.anNote, s.fanNote, s.nineVirtues, s.operator, s.defects.join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(kw),
        );
      };
    },
    defectCount(state): number {
      return state.stringings.filter((s) => s.defects.some((d) => d !== '无')).length;
    },
  },

  actions: {
    async hydrate() {
      this.stringings = await db.stringings.orderBy('strungAt').reverse().toArray();
      this.hydrated = true;
    },

    /**
     * 提交上弦草稿：每张琴一份上弦记录。
     * - create：该琴号已有记录时按琴号占用冲突处理；
     * - edit：按 rev 三向核对，改填琴号被占用同样列出冲突；
     * - 评语相对库内现行值有变化时，把现行评语压入历史版本（对方页签的改动不会被我方覆盖丢失）。
     */
    async commitStringing(req: StringingCommitRequest): Promise<Stringing> {
      const rec = stringingFormToRecord(req.form);
      const specs = FIELD_SPECS.stringing;
      let committed!: Stringing;

      await db.transaction('rw', db.stringings, async () => {
        const now = new Date().toISOString();
        if (req.mode === 'create') {
          const taken = await db.stringings.where('guqinNo').equals(rec.guqinNo as string).first();
          if (taken) {
            throw new ConflictError(
              recordConflict('stringing', 'guqin-taken', taken.rev, `琴号 ${taken.guqinNo} 已有上弦档案（另一页签刚登记），请改为编辑该记录`),
            );
          }
          const stringing: Stringing = {
            id: uid('stringing'),
            guqinNo: rec.guqinNo as string,
            stringType: rec.stringType as StringType,
            nut: rec.nut as string,
            stringGap: rec.stringGap as number,
            sanNote: rec.sanNote as string,
            anNote: rec.anNote as string,
            fanNote: rec.fanNote as string,
            nineVirtues: rec.nineVirtues as string,
            defects: rec.defects as StringDefect[],
            strungAt: rec.strungAt as string,
            operator: rec.operator as string,
            noteVersions: [],
            rev: 1,
            updatedAt: now,
          };
          await db.stringings.put(toPlain(stringing));
          committed = stringing;
          return;
        }

        const current = await db.stringings.get(req.sessionId);
        if (!current) {
          throw new ConflictError(recordConflict('stringing', 'record-deleted', 0, '这条上弦档案已被另一个页签删除'));
        }
        const taken = await db.stringings.where('guqinNo').equals(rec.guqinNo as string).first();
        if (taken && taken.id !== current.id) {
          throw new ConflictError(
            recordConflict('stringing', 'guqin-taken', taken.rev, `琴号 ${taken.guqinNo} 已被另一条上弦档案占用，无法改填该琴号`),
          );
        }
        const base = req.base ?? current;
        const merged = resolveGuardedMerge('stringing', specs, base, current, rec, req.resolutions, req.expectedRev);

        // 评语历史版本：相对库内现行值发生变化才记录，保证对方页签补录的评语不丢
        const notesChanged =
          merged.sanNote !== current.sanNote ||
          merged.anNote !== current.anNote ||
          merged.fanNote !== current.fanNote ||
          merged.nineVirtues !== current.nineVirtues;
        const versions = [...current.noteVersions];
        if (notesChanged) {
          const version: ToneVersion = {
            id: uid('tone'),
            savedAt: now,
            sanNote: current.sanNote,
            anNote: current.anNote,
            fanNote: current.fanNote,
            nineVirtues: current.nineVirtues,
          };
          versions.unshift(version);
        }

        committed = {
          id: current.id,
          guqinNo: merged.guqinNo as string,
          stringType: merged.stringType as StringType,
          nut: merged.nut as string,
          stringGap: merged.stringGap as number,
          sanNote: merged.sanNote as string,
          anNote: merged.anNote as string,
          fanNote: merged.fanNote as string,
          nineVirtues: merged.nineVirtues as string,
          defects: merged.defects as StringDefect[],
          strungAt: merged.strungAt as string,
          operator: merged.operator as string,
          noteVersions: versions,
          rev: current.rev + 1,
          updatedAt: now,
        };
        await db.stringings.put(toPlain(committed));
      });

      this.stringings = committed.rev === 1 ? [committed, ...this.stringings] : this.stringings.map((s) => (s.id === committed.id ? committed : s));
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
      return committed;
    },

    async removeStringing(id: string) {
      await db.stringings.delete(id);
      this.stringings = this.stringings.filter((s) => s.id !== id);
      postBus({ type: 'archive-committed', at: new Date().toISOString() });
    },
  },
});
