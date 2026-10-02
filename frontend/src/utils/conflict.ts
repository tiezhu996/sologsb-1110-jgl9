import type { DraftKind } from '../types/draft';

/** 单条字段冲突的双方改动 */
export interface FieldConflict {
  /** 实体字段名（正式档案键名） */
  key: string;
  /** 中文列名 */
  label: string;
  /** 页面打开时（基线）的值 */
  base: unknown;
  /** 对方页签已提交进正式档案的值 */
  theirs: unknown;
  /** 本页签草稿里的值 */
  ours: unknown;
  /** 重试时采用哪一方；未选择的字段保留草稿 */
  resolution: 'ours' | 'theirs';
}

/** 正式记录已被对方删除 / 琴号被另一张记录占用时的整记录冲突 */
export type RecordIssue = 'record-deleted' | 'guqin-taken';

/**
 * 提交失败（核对未通过）的结果：
 * 原正式档案与草稿都原样保留，页面据此展示双方改动并重试。
 */
export interface CommitConflict {
  kind: DraftKind;
  /** 失败原因：字段级冲突 / 记录被删 / 琴号占用 */
  issue: RecordIssue | 'fields';
  /** 对方提交后正式档案当前版本号（重试时按此版本再核对） */
  currentRev: number;
  /** 冲突说明（整记录冲突时使用） */
  message?: string;
  /** 字段级冲突列表 */
  fields: FieldConflict[];
}

/** 冲突时抛出的错误：事务回滚，正式档案不改动；捕获后草稿仍可重试 */
export class ConflictError extends Error {
  conflict: CommitConflict;
  constructor(conflict: CommitConflict) {
    super(conflict.message ?? `检测到 ${conflict.fields.length} 处字段冲突`);
    this.name = 'ConflictError';
    this.conflict = conflict;
  }
}

/** 参与三向比对的字段描述 */
export interface FieldSpec {
  key: string;
  label: string;
}

function equalish(a: unknown, b: unknown): boolean {
  // 表单会把缺省的 undefined 备注等自然变成空串，二者视为相同；数字按 0.001 精度归一
  const norm = (v: unknown): string =>
    JSON.stringify(v, (_key, value) => {
      if (value === undefined || value === '') return null;
      if (typeof value === 'number') return Number(value.toFixed(3));
      return value;
    });
  return norm(a) === norm(b);
}

/**
 * 三向比对：base=页面打开时的正式档案，theirs=库内现行正式档案，ours=草稿展开后的待写记录。
 * 仅当双方都改了同一字段且改成不同值时才算冲突；对方独自改动的字段直接并入正式值，不打扰档案员。
 */
export function diff3(
  base: Record<string, unknown>,
  theirs: Record<string, unknown>,
  ours: Record<string, unknown>,
  specs: FieldSpec[],
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const spec of specs) {
    const baseValue = base[spec.key];
    const theirValue = theirs[spec.key];
    const ourValue = ours[spec.key];
    const theyChanged = !equalish(baseValue, theirValue);
    const weChanged = !equalish(baseValue, ourValue);
    if (theyChanged && weChanged && !equalish(theirValue, ourValue)) {
      conflicts.push({
        key: spec.key,
        label: spec.label,
        base: baseValue,
        theirs: theirValue,
        ours: ourValue,
        resolution: 'ours',
      });
    }
  }
  return conflicts;
}

/**
 * 按档案员逐项选择合并最终表单：
 * - 冲突字段取所选一方；
 * - 对方独自改动（本页签未改）的字段并入对方新值；
 * - 其余字段沿用草稿。
 */
export function mergeResolution(
  base: Record<string, unknown>,
  theirs: Record<string, unknown>,
  ours: Record<string, unknown>,
  specs: FieldSpec[],
  fields: FieldConflict[],
): Record<string, unknown> {
  const chosen = new Map(fields.map((f) => [f.key, f.resolution]));
  const merged: Record<string, unknown> = { ...ours };
  for (const spec of specs) {
    const resolution = chosen.get(spec.key);
    if (resolution === 'theirs') {
      merged[spec.key] = theirs[spec.key];
    } else if (resolution === 'ours') {
      merged[spec.key] = ours[spec.key];
    } else if (!equalish(base[spec.key], theirs[spec.key]) && equalish(base[spec.key], ours[spec.key])) {
      merged[spec.key] = theirs[spec.key];
    }
  }
  return merged;
}

export function fieldsConflict(
  kind: DraftKind,
  currentRev: number,
  fields: FieldConflict[],
): CommitConflict {
  return { kind, issue: 'fields', currentRev, fields };
}

export function recordConflict(
  kind: DraftKind,
  issue: RecordIssue,
  currentRev: number,
  message: string,
): CommitConflict {
  return { kind, issue, currentRev, message, fields: [] };
}

/** 冲突列表是否全部已做选择（重试前校验） */
export function conflictsResolved(fields: FieldConflict[]): boolean {
  return fields.every((f) => f.resolution === 'ours' || f.resolution === 'theirs');
}

function extractBySpecs(specs: FieldSpec[], entity: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(specs.map((s) => [s.key, entity[s.key]]));
}

/**
 * 正式档案版本核对 + 三向合并（四类工序共用）：
 * - rev 未变：草稿即为最终值；
 * - rev 已变且无字段冲突：对方独自改动自动并入；
 * - rev 已变且存在字段冲突：抛 ConflictError，双方改动原样保留供页面列出；
 * - 带 resolutions/expectedRev 的重试：对方在核对期间又提交则重新列出冲突，
 *   否则按逐项选择合并（未选择的字段继续报错，可再次重试）。
 */
export function resolveGuardedMerge<T extends { rev: number }>(
  kind: DraftKind,
  specs: FieldSpec[],
  base: T,
  current: T,
  rec: Record<string, unknown>,
  resolutions?: Record<string, 'ours' | 'theirs'>,
  expectedRev?: number,
): Record<string, unknown> {
  const baseRec = extractBySpecs(specs, base as unknown as Record<string, unknown>);
  const theirsRec = extractBySpecs(specs, current as unknown as Record<string, unknown>);

  if (resolutions && expectedRev !== undefined) {
    if (current.rev !== expectedRev) {
      throw new ConflictError(fieldsConflict(kind, current.rev, diff3(baseRec, theirsRec, rec, specs)));
    }
    const fields = diff3(baseRec, theirsRec, rec, specs);
    // 重试期间对方又改了别的字段，出现未选择的新冲突：重新列出，不能静默采用某一方
    if (fields.some((f) => resolutions[f.key] !== 'ours' && resolutions[f.key] !== 'theirs')) {
      throw new ConflictError(fieldsConflict(kind, current.rev, fields));
    }
    const resolved = fields.map((f) => ({ ...f, resolution: resolutions[f.key] }));
    return mergeResolution(baseRec, theirsRec, rec, specs, resolved);
  }

  if (current.rev !== base.rev) {
    const fields = diff3(baseRec, theirsRec, rec, specs);
    if (fields.length) {
      throw new ConflictError(fieldsConflict(kind, current.rev, fields));
    }
    return mergeResolution(baseRec, theirsRec, rec, specs, []);
  }
  return rec;
}
