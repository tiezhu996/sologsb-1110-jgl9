import Dexie, { type Table } from 'dexie';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { ProcessDraft } from '../types/draft';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbguqin-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class GuqinDB extends Dexie {
  boards!: Table<WoodBoard, string>;
  chambers!: Table<SoundChamber, string>;
  lacquers!: Table<LacquerLayer, string>;
  stringings!: Table<Stringing, string>;
  /** 工序草稿：与正式档案分表保存，按页签隔离 */
  drafts!: Table<ProcessDraft, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, postPos, carvedAt',
      lacquers: 'id, guqinNo, seq, appliedAt',
      stringings: 'id, guqinNo, stringType, strungAt',
      meta: 'key',
    });

    // v2：髹漆表增加 (guqinNo+seq) 复合索引，便于按遍次排序查询；并回填历史 layerThickness。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
        chambers: 'id, guqinNo, postPos, carvedAt',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
        stringings: 'id, guqinNo, stringType, strungAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('lacquers')
          .toCollection()
          .modify((row: LacquerLayer) => {
            if (!row.layerThickness && row.totalThickness) {
              row.layerThickness = row.totalThickness;
            }
          });
      });

    // v3：正式档案与草稿分存。新增 drafts 表（按页签隔离的工序草稿）；
    // 四类正式档案补乐观锁版本号 version（旧数据按初版 1 兼容）。
    // 首页进度、导出备份、异常统计只认四张正式表，drafts 不参与。
    this.version(3)
      .stores({
        boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt, version',
        chambers: 'id, guqinNo, postPos, carvedAt, version',
        lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt, version',
        stringings: 'id, guqinNo, stringType, strungAt, version',
        drafts: 'id, tabId, kind, targetId, updatedAt',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        for (const tableName of ['boards', 'chambers', 'lacquers', 'stringings'] as const) {
          await tx
            .table(tableName)
            .toCollection()
            .modify((row: { version?: number }) => {
              if (typeof row.version !== 'number') {
                row.version = 1;
              }
            });
        }
      });
  }
}

export const db = new GuqinDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
