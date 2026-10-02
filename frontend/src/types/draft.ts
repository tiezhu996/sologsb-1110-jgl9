/**
 * 工序草稿与乐观锁并发提交。
 *
 * 草稿与正式工序档案分开保存：四张正式表（boards/chambers/lacquers/stringings）
 * 只在“提交”成功后改变；草稿存于独立的 drafts 表，按页签（tabId）隔离，
 * 同机两个页签各改各的草稿，互不覆盖。
 */

/** 四类工序记录（对应四类正式档案） */
export type DraftKind = 'board' | 'chamber' | 'lacquer' | 'stringing';

/** 草稿载荷：编辑表单整理后的完整记录（不含乐观锁字段；字段访问时自行归一化） */
export type DraftPayload = Record<string, unknown>;

/** 一条工序草稿（每个页签、每类记录、每条目标各一份） */
export interface ProcessDraft {
  /** 主键：`${tabId}:${kind}:${targetId}` */
  id: string;
  /** 所属页签（sessionStorage 中的页签实例号），草稿按页签隔离 */
  tabId: string;
  /** 工序类别 */
  kind: DraftKind;
  /**
   * 目标记录 id：编辑已有记录为其正式档案 id；
   * 另一个页签可能已把同号新记录提交，提交时按 resolveKey 认领先正式档案。
   */
  targetId: string;
  /**
   * 认领键：新记录用于在正式档案中认领“别的页签已抢先提交的同号记录”，
   * 形如 `guqinNo` / `guqinNo:part` / `guqinNo:seq`；编辑已有记录时为空。
   */
  resolveKey: string;
  /** 本页签当前编辑内容（完整字段） */
  payload: DraftPayload;
  /**
   * 打开编辑时的版本号：已有记录取其正式档案 version；新记录为 0。
   * 提交时与正式档案当前 version 核对，不一致说明期间有人提交过。
   */
  baseVersion: number;
  /** 打开编辑时的字段快照（用于三方比对）；新记录为空对象 */
  baseSnapshot: Record<string, unknown>;
  /** 记录打开时在正式档案中是否存在（不存在即新建草稿） */
  existed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 单个字段的双方冲突明细 */
export interface FieldConflict {
  field: string;
  label: string;
  /** 打开时的值 */
  base: unknown;
  /** 对方页签已提交进正式档案的值 */
  theirs: unknown;
  /** 本页签草稿中的值 */
  mine: unknown;
}

/** 提交核对结果 */
export interface CommitCheck {
  /** 是否可直接提交（无双方同改冲突） */
  ok: boolean;
  /** 期间正式档案是否被其他页签改写（version 变化或被新建/删除） */
  changed: boolean;
  /** 正式档案是否已不存在（被删，或尚未创建） */
  missing: boolean;
  /** 双方都改了同一字段的冲突明细 */
  conflicts: FieldConflict[];
  /** 可自动并入的字段（对方改过、本页签未动） */
  mergeable: string[];
}
