/**
 * 正式工序档案版本归一化：
 * db v3 升级只回填已存在的正式表；种子数据、旧版 JSON 备份恢复同样可能缺少 rev/updatedAt，
 * 统一按「初版 rev=1、提交时间取原施工/入库时间」兼容。
 */
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';

/** v1/v2 时代或种子数据里还没有版本字段的档案 */
export type Unversioned<T> = Omit<T, 'rev' | 'updatedAt'>;

type MaybeVersioned<T> = Omit<T, 'rev' | 'updatedAt'> & { rev?: number; updatedAt?: string };

function withRev<T extends object>(entity: T, timestamp: string): T & { rev: number; updatedAt: string } {
  const raw = entity as Record<string, unknown> & { updatedAt?: string };
  const rev = Number.isFinite(Number(raw.rev)) && Number(raw.rev) > 0 ? Number(raw.rev) : 1;
  return { ...entity, rev, updatedAt: raw.updatedAt || timestamp };
}

export function normalizeBoard(board: MaybeVersioned<WoodBoard>): WoodBoard {
  return withRev(board, board.receivedAt);
}

export function normalizeChamber(chamber: MaybeVersioned<SoundChamber>): SoundChamber {
  return withRev(chamber, chamber.carvedAt);
}

export function normalizeLayer(layer: MaybeVersioned<LacquerLayer>): LacquerLayer {
  return withRev(layer, layer.appliedAt);
}

export function normalizeStringing(
  stringing: MaybeVersioned<Stringing> & { noteVersions?: Stringing['noteVersions'] },
): Stringing {
  return {
    ...withRev(stringing, stringing.strungAt),
    noteVersions: Array.isArray(stringing.noteVersions) ? stringing.noteVersions : [],
  };
}

/** 批量补齐版本信息（旧数据/旧备份按初版兼容） */
export function normalizeArchives(
  boards: MaybeVersioned<WoodBoard>[],
  chambers: MaybeVersioned<SoundChamber>[],
  layers: MaybeVersioned<LacquerLayer>[],
  stringings: Array<MaybeVersioned<Stringing> & { noteVersions?: Stringing['noteVersions'] }>,
): { boards: WoodBoard[]; chambers: SoundChamber[]; lacquers: LacquerLayer[]; stringings: Stringing[] } {
  return {
    boards: boards.map(normalizeBoard),
    chambers: chambers.map(normalizeChamber),
    lacquers: layers.map(normalizeLayer),
    stringings: stringings.map(normalizeStringing),
  };
}
