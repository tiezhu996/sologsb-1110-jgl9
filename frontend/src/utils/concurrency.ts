import type { CommitCheck, FieldConflict } from '../types/draft';

/**
 * 三方合并：base（页面打开时的快照）/ mine（本页签草稿）/ theirs（正式档案最新）。
 * - 只有一方改动：直接采纳，不冲突；
 * - 双方都改了同一字段且改成不同值：列为冲突，交档案员选择。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 比较两个字段值是否一致（按结构化内容比较，数组顺序敏感） */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => sameValue(a[k], b[k]));
  }
  return false;
}

/**
 * 核对草稿与正式档案（三方比对）。
 * @param base 打开时快照；记录当时不存在则为 null
 * @param mine 本页签草稿字段
 * @param theirs 正式档案当前字段；已被删除/尚未创建则为 null
 * @param fields 需要核对的字段名（顺序即展示顺序）
 */
export function checkCommit(
  base: Record<string, unknown> | null,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown> | null,
  fields: Array<{ key: string; label: string }>,
): CommitCheck {
  const conflicts: FieldConflict[] = [];
  const mergeable: string[] = [];

  const existed = base !== null;
  const missing = theirs === null;

  for (const { key, label } of fields) {
    const baseVal = base?.[key];
    const mineVal = mine[key];
    const theirVal = theirs?.[key];

    const mineChanged = !sameValue(baseVal, mineVal);
    let theirsChanged: boolean;
    if (!existed) {
      // 新建：档案尚不存在是常态，对方状态以“是否已创建”为准，逐字段不视为改动
      theirsChanged = false;
    } else if (missing) {
      // 编辑期间记录被另一页签删除：我方改动的字段都列入双方分歧
      theirsChanged = mineChanged;
    } else {
      theirsChanged = !sameValue(baseVal, theirVal);
    }

    if (mineChanged && theirsChanged) {
      // 双方都动过：值一致（或对方记录已消失）才不冲突
      if (!missing && sameValue(mineVal, theirVal)) {
        // 改成了同一个值，无需处理
      } else {
        conflicts.push({ field: key, label, base: baseVal, theirs: theirVal, mine: mineVal });
      }
    } else if (theirsChanged && !mineChanged) {
      // 对方改了、本页签没动：自动并入对方的值
      mergeable.push(key);
    }
  }

  const changed = existed ? missing || conflicts.length > 0 || mergeable.length > 0 : !missing;
  return { ok: conflicts.length === 0, changed, missing, conflicts, mergeable };
}

/** 自动合并：对方改动且本页签未动的字段取正式档案现值，其余取草稿值 */
export function autoMerge<T extends Record<string, unknown>>(
  mine: T,
  theirs: Record<string, unknown> | null,
  check: CommitCheck,
): T {
  if (!theirs) return { ...mine };
  const merged: Record<string, unknown> = { ...mine };
  for (const key of check.mergeable) {
    if (key in theirs) merged[key] = theirs[key];
  }
  return merged as T;
}

/** 按冲突解决选项生成最终字段集（resolved：field -> 取值来源） */
export function resolveMerged<T extends Record<string, unknown>>(
  mine: T,
  theirs: Record<string, unknown> | null,
  check: CommitCheck,
  resolved: Record<string, 'mine' | 'theirs'>,
): T {
  const merged = autoMerge(mine, theirs, check);
  if (!theirs) return merged;
  for (const conflict of check.conflicts) {
    if (resolved[conflict.field] === 'theirs') {
      (merged as Record<string, unknown>)[conflict.field] = theirs[conflict.field];
    }
  }
  return merged;
}

/** 把字段值格式化为展示文本 */
export function formatConflictValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）';
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  return String(value);
}

/** 仍未被处理的冲突字段（提交时必须逐字段选择保留哪一方） */
export function unresolvedConflicts(
  check: CommitCheck,
  resolved: Record<string, 'mine' | 'theirs'>,
): FieldConflict[] {
  return check.conflicts.filter((c) => resolved[c.field] !== 'mine' && resolved[c.field] !== 'theirs');
}

/** 提交失败原因（正式档案未改动、草稿保留） */
export type CommitFailureReason = 'conflict' | 'deleted';

/** 提交失败：事务回滚，正式档案保持原样、草稿保留可重试 */
export class CommitFailedError extends Error {
  constructor(
    public readonly check: CommitCheck,
    public readonly reason: CommitFailureReason,
  ) {
    super(reason === 'deleted' ? '正式档案已被另一页签删除，提交已中止' : '存在双方同改冲突，需逐字段确认后重试');
    this.name = 'CommitFailedError';
  }
}
