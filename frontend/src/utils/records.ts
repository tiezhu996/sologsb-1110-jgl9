import type { DraftKind } from '../types/draft';

/** 四类记录参与并发核对的业务字段（id / version 等系统字段不在其列） */
export const RECORD_FIELDS: Record<DraftKind, Array<{ key: string; label: string }>> = {
  board: [
    { key: 'boardNo', label: '板材号' },
    { key: 'guqinNo', label: '琴号' },
    { key: 'part', label: '部位' },
    { key: 'species', label: '树种' },
    { key: 'dryYears', label: '阴干年限' },
    { key: 'thicknessMm', label: '厚度(mm)' },
    { key: 'grain', label: '木纹' },
    { key: 'defect', label: '缺陷' },
    { key: 'receivedAt', label: '入库日期' },
    { key: 'remark', label: '备注' },
  ],
  chamber: [
    { key: 'guqinNo', label: '琴号' },
    { key: 'nayinThickness', label: '纳音厚度' },
    { key: 'longchiThickness', label: '龙池厚度' },
    { key: 'fengzhaoThickness', label: '凤沼厚度' },
    { key: 'chamberDepth', label: '槽腹深度' },
    { key: 'postPos', label: '天地柱' },
    { key: 'poolSize', label: '龙池凤沼尺寸' },
    { key: 'carvedAt', label: '掏膛日期' },
    { key: 'carver', label: '掏膛人' },
    { key: 'remark', label: '备注' },
  ],
  lacquer: [
    { key: 'guqinNo', label: '琴号' },
    { key: 'mixRatio', label: '灰胎配比' },
    { key: 'curingTemp', label: '荫房温度' },
    { key: 'curingHumidity', label: '荫房湿度' },
    { key: 'polishGrit', label: '打磨目数' },
    { key: 'layerThickness', label: '本遍厚度' },
    { key: 'appliedAt', label: '施工日期' },
    { key: 'operator', label: '髹漆人' },
    { key: 'remark', label: '备注' },
  ],
  stringing: [
    { key: 'guqinNo', label: '琴号' },
    { key: 'stringType', label: '弦材质' },
    { key: 'nut', label: '雁足与绒扣' },
    { key: 'stringGap', label: '弦距' },
    { key: 'sanNote', label: '散音评语' },
    { key: 'anNote', label: '按音评语' },
    { key: 'fanNote', label: '泛音评语' },
    { key: 'nineVirtues', label: '九德简述' },
    { key: 'defects', label: '缺陷' },
    { key: 'strungAt', label: '上弦日期' },
    { key: 'operator', label: '上弦人' },
  ],
};

const SYSTEM_KEYS = new Set(['id', 'version', 'seq', 'totalThickness', 'noteVersions']);

/** 取参与三方比对的业务字段快照（深拷贝，脱响应式代理） */
export function comparableSnapshot(kind: DraftKind, record: { version?: number }): Record<string, unknown> {
  const source = record as unknown as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const { key } of RECORD_FIELDS[kind]) {
    snapshot[key] = source[key];
  }
  return JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
}

/** 由正式记录生成打开时快照，用于新建草稿 */
export function snapshotOfRecord(kind: DraftKind, record: { version?: number } | undefined): {
  snapshot: Record<string, unknown>;
  version: number;
  existed: boolean;
} {
  if (!record) return { snapshot: {}, version: 0, existed: false };
  return { snapshot: comparableSnapshot(kind, record), version: record.version ?? 1, existed: true };
}

export function isSystemKey(key: string): boolean {
  return SYSTEM_KEYS.has(key);
}
