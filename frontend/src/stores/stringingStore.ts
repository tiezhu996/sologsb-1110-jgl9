import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { subscribeTable } from '../utils/live';
import { RECORD_FIELDS } from '../utils/records';
import { checkCommit, resolveMerged, CommitFailedError, unresolvedConflicts } from '../utils/concurrency';
import type { StringDefect, StringType, Stringing, ToneVersion } from '../types/stringing';
import type { CommitCheck, DraftPayload, ProcessDraft } from '../types/draft';

export interface StringingInput {
  guqinNo: string;
  stringType: StringType;
  nut: string;
  stringGap: number;
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
  defects: StringDefect[];
  strungAt?: string;
  operator: string;
}

interface StringingState {
  /** 正式上弦档案（liveQuery 订阅，跨页签提交后自动同步） */
  stringings: Stringing[];
  hydrated: boolean;
}

/** 认领键：每张琴一份上弦记录 */
export function stringingResolveKey(guqinNo: string): string {
  return guqinNo.trim();
}

/** 上弦与文字评语（纯文本，不做音频处理）；评语历史在提交落档时生成 */
export const useStringingStore = defineStore('stringing', {
  state: (): StringingState => ({ stringings: [], hydrated: false }),

  getters: {
    byGuqin(state) {
      return (guqinNo: string): Stringing | undefined => state.stringings.find((s) => s.guqinNo === guqinNo);
    },
    /** 三段评语 + 九德的文字检索（只检索正式档案，不含草稿） */
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
    hydrate() {
      const sub = subscribeTable(
        () => db.stringings.orderBy('strungAt').reverse().toArray(),
        (rows) => {
          this.stringings = rows;
        },
      );
      this.hydrated = true;
      return sub;
    },

    findTarget(draft: ProcessDraft): Stringing | undefined {
      const byId = this.stringings.find((s) => s.id === draft.targetId);
      if (byId || draft.existed) return byId;
      const guqinNo = stringingResolveKey(String(draft.payload.guqinNo ?? ''));
      return this.stringings.find((s) => stringingResolveKey(s.guqinNo) === guqinNo);
    },

    prepareCommit(draft: ProcessDraft): { check: CommitCheck; current: Stringing | undefined } {
      const current = this.findTarget(draft);
      const base = draft.existed ? draft.baseSnapshot : null;
      const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
      const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.stringing);
      return { check, current };
    },

    /**
     * 乐观锁提交。评语历史版本在落档瞬间依据正式档案现值生成：
     * 只有最终写入的评语与档案现值不同，才把“改动前的正式评语”存入版本对照，
     * 避免把未经确认的草稿中间态写进历史。
     */
    async commitDraft(
      draft: ProcessDraft,
      resolved: Record<string, 'mine' | 'theirs'> = {},
    ): Promise<Stringing> {
      const payload = draft.payload as unknown as StringingInput;
      const buildRow = (fields: DraftPayload, version: number, prev?: Stringing): Stringing => {
        const sanNote = String(fields.sanNote ?? '').trim();
        const anNote = String(fields.anNote ?? '').trim();
        const fanNote = String(fields.fanNote ?? '').trim();
        const nineVirtues = String(fields.nineVirtues ?? '').trim();
        const noteVersions = [...(prev?.noteVersions ?? [])];
        const notesChanged =
          prev &&
          (sanNote !== prev.sanNote || anNote !== prev.anNote || fanNote !== prev.fanNote || nineVirtues !== prev.nineVirtues);
        if (notesChanged && prev) {
          const versionRow: ToneVersion = {
            id: uid('tone'),
            savedAt: new Date().toISOString(),
            sanNote: prev.sanNote,
            anNote: prev.anNote,
            fanNote: prev.fanNote,
            nineVirtues: prev.nineVirtues,
          };
          noteVersions.unshift(versionRow);
        }
        return {
          id: prev?.id ?? draft.targetId,
          guqinNo: String(fields.guqinNo ?? '').trim(),
          stringType: fields.stringType as StringType,
          nut: String(fields.nut ?? '').trim(),
          stringGap: Number(fields.stringGap) || 0,
          sanNote,
          anNote,
          fanNote,
          nineVirtues,
          defects: Array.isArray(fields.defects) && fields.defects.length ? (fields.defects as StringDefect[]) : ['无'],
          strungAt: prev?.strungAt ?? String(fields.strungAt ?? new Date().toISOString()),
          operator: String(fields.operator ?? '').trim(),
          noteVersions,
          version,
        };
      };

      return db.transaction('rw', db.stringings, async () => {
        const all = await db.stringings.toArray();
        const byId = all.find((s) => s.id === draft.targetId);
        const byKey = !draft.existed
          ? all.find((s) => stringingResolveKey(s.guqinNo) === stringingResolveKey(String(payload.guqinNo)))
          : undefined;
        const current = byId ?? byKey;

        const base = draft.existed ? draft.baseSnapshot : null;
        const theirs = current ? JSON.parse(JSON.stringify(current)) : null;
        const check = checkCommit(base, draft.payload, theirs, RECORD_FIELDS.stringing);

        if (unresolvedConflicts(check, resolved).length) {
          throw new CommitFailedError(check, 'conflict');
        }
        if (draft.existed && !current) {
          throw new CommitFailedError(check, 'deleted');
        }

        const fields = resolveMerged(draft.payload, theirs, check, resolved);
        const nextVersion = current ? (current.version ?? 1) + 1 : 1;
        const row = buildRow(fields, nextVersion, current);
        await db.stringings.put(toPlain(row));
        return row;
      });
    },

    async removeStringing(id: string) {
      await db.stringings.delete(id);
    },
  },
});

/** 新建上弦草稿的临时 id */
export function newStringingDraftId(): string {
  return uid('stringing-new');
}
