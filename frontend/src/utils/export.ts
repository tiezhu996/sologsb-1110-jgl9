import { db, SCHEMA_VERSION } from './db';

/**
 * 备份只含四张正式工序档案表；草稿是页签私有的未提交内容，不进入备份。
 */
export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  boards: unknown[];
  chambers: unknown[];
  lacquers: unknown[];
  stringings: unknown[];
}

/** 旧版备份/历史数据没有乐观锁字段，按初版 version=1 兼容 */
function withVersion<T>(rows: T[] | undefined): T[] {
  return (rows ?? []).map((row) => {
    const item = row as { version?: number };
    if (typeof item.version !== 'number') item.version = 1;
    return row;
  });
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [boards, chambers, lacquers, stringings] = await Promise.all([
    db.boards.toArray(),
    db.chambers.toArray(),
    db.lacquers.toArray(),
    db.stringings.toArray(),
  ]);
  return {
    app: 'gbguqin',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    boards,
    chambers,
    lacquers,
    stringings,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（工序档案打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/** 恢复 JSON 备份 */
export async function importBackup(text: string): Promise<{ boards: number; chambers: number; lacquers: number; stringings: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbguqin') {
    throw new Error('备份文件格式不匹配（缺少 app=gbguqin 标记）');
  }
  const counts = {
    boards: payload.boards?.length ?? 0,
    chambers: payload.chambers?.length ?? 0,
    lacquers: payload.lacquers?.length ?? 0,
    stringings: payload.stringings?.length ?? 0,
  };
  const boards = withVersion(payload.boards as never[]);
  const chambers = withVersion(payload.chambers as never[]);
  const lacquers = withVersion(payload.lacquers as never[]);
  const stringings = withVersion(payload.stringings as never[]);
  // 恢复会整体替换正式档案；页签草稿引用的旧版本可能已失效，一并清空避免错配
  await db.transaction('rw', db.boards, db.chambers, db.lacquers, db.stringings, db.drafts, async () => {
    await Promise.all([db.boards.clear(), db.chambers.clear(), db.lacquers.clear(), db.stringings.clear(), db.drafts.clear()]);
    if (boards.length) await db.boards.bulkPut(boards);
    if (chambers.length) await db.chambers.bulkPut(chambers);
    if (lacquers.length) await db.lacquers.bulkPut(lacquers);
    if (stringings.length) await db.stringings.bulkPut(stringings);
  });
  return counts;
}
