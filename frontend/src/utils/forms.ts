import type { FieldSpec } from './conflict';
import type {
  BoardDraftForm,
  ChamberDraftForm,
  DraftKind,
  LacquerDraftForm,
  StringingDraftForm,
} from '../types/draft';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';

const dateToIso = (day: string): string => new Date(`${day || new Date().toISOString().slice(0, 10)}T09:00:00`).toISOString();

/** 三向比对使用的字段（rev/id/时间戳/自动累计值不参与） */
export const FIELD_SPECS: Record<DraftKind, FieldSpec[]> = {
  board: [
    { key: 'boardNo', label: '板材号' },
    { key: 'guqinNo', label: '琴号' },
    { key: 'part', label: '部位' },
    { key: 'species', label: '树种' },
    { key: 'dryYears', label: '阴干年限' },
    { key: 'thicknessMm', label: '厚度' },
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
    { key: 'defects', label: '缺陷标记' },
    { key: 'strungAt', label: '上弦日期' },
    { key: 'operator', label: '上弦人' },
  ],
};

/* ---------------- 表单默认值（登记弹窗初始内容） ---------------- */

export function emptyBoardForm(): BoardDraftForm {
  return {
    boardNo: `MB-${Date.now().toString().slice(-4)}`,
    guqinNo: '',
    part: '面板',
    species: '桐木',
    dryYears: 5,
    thicknessMm: 30,
    grain: '直纹',
    defect: '无',
    receivedAt: new Date().toISOString().slice(0, 10),
    remark: '',
  };
}

export function emptyChamberForm(): ChamberDraftForm {
  return {
    guqinNo: '',
    nayinThickness: 15,
    longchiThickness: 13,
    fengzhaoThickness: 14,
    chamberDepth: 26,
    postPos: '天柱中',
    poolSize: '200×22',
    carvedAt: new Date().toISOString().slice(0, 10),
    carver: '周砚秋',
    remark: '',
  };
}

export function emptyLacquerForm(): LacquerDraftForm {
  return {
    guqinNo: '',
    mixRatio: '1:1',
    curingTemp: 25,
    curingHumidity: 78,
    polishGrit: 320,
    layerThickness: 0.1,
    appliedAt: new Date().toISOString().slice(0, 10),
    operator: '林听雪',
    remark: '',
  };
}

export function emptyStringingForm(): StringingDraftForm {
  return {
    guqinNo: '',
    stringType: '丝弦',
    nut: '红木雁足 + 丝绒扣',
    stringGap: 17,
    defects: ['无'],
    strungAt: new Date().toISOString().slice(0, 10),
    operator: '周砚秋',
    tone: { sanNote: '', anNote: '', fanNote: '', nineVirtues: '' },
  };
}

/* ---------------- 正式档案 → 编辑表单（打开时的草稿初值/基线） ---------------- */

export function boardToForm(board: WoodBoard): BoardDraftForm {
  return {
    boardNo: board.boardNo,
    guqinNo: board.guqinNo,
    part: board.part,
    species: board.species,
    dryYears: board.dryYears,
    thicknessMm: board.thicknessMm,
    grain: board.grain,
    defect: board.defect,
    receivedAt: board.receivedAt.slice(0, 10),
    remark: board.remark ?? '',
  };
}

export function chamberToForm(chamber: SoundChamber): ChamberDraftForm {
  return {
    guqinNo: chamber.guqinNo,
    nayinThickness: chamber.nayinThickness,
    longchiThickness: chamber.longchiThickness,
    fengzhaoThickness: chamber.fengzhaoThickness,
    chamberDepth: chamber.chamberDepth,
    postPos: chamber.postPos,
    poolSize: chamber.poolSize,
    carvedAt: chamber.carvedAt.slice(0, 10),
    carver: chamber.carver,
    remark: chamber.remark ?? '',
  };
}

export function lacquerToForm(layer: LacquerLayer): LacquerDraftForm {
  return {
    guqinNo: layer.guqinNo,
    mixRatio: layer.mixRatio,
    curingTemp: layer.curingTemp,
    curingHumidity: layer.curingHumidity,
    polishGrit: layer.polishGrit,
    layerThickness: layer.layerThickness,
    appliedAt: layer.appliedAt.slice(0, 10),
    operator: layer.operator,
    remark: layer.remark ?? '',
  };
}

export function stringingToForm(stringing: Stringing): StringingDraftForm {
  return {
    guqinNo: stringing.guqinNo,
    stringType: stringing.stringType,
    nut: stringing.nut,
    stringGap: stringing.stringGap,
    defects: [...stringing.defects],
    strungAt: stringing.strungAt.slice(0, 10),
    operator: stringing.operator,
    tone: {
      sanNote: stringing.sanNote,
      anNote: stringing.anNote,
      fanNote: stringing.fanNote,
      nineVirtues: stringing.nineVirtues,
    },
  };
}

/* ---------------- 表单 → 可比对的普通记录（ISO 日期、trim 文本） ---------------- */

export function boardFormToRecord(form: BoardDraftForm): Record<string, unknown> {
  return {
    boardNo: form.boardNo.trim(),
    guqinNo: form.guqinNo.trim(),
    part: form.part,
    species: form.species,
    dryYears: Number(form.dryYears) || 0,
    thicknessMm: Number(form.thicknessMm) || 0,
    grain: form.grain,
    defect: form.defect,
    receivedAt: dateToIso(form.receivedAt),
    remark: form.remark.trim(),
  };
}

export function chamberFormToRecord(form: ChamberDraftForm): Record<string, unknown> {
  return {
    guqinNo: form.guqinNo.trim(),
    nayinThickness: Number(form.nayinThickness) || 0,
    longchiThickness: Number(form.longchiThickness) || 0,
    fengzhaoThickness: Number(form.fengzhaoThickness) || 0,
    chamberDepth: Number(form.chamberDepth) || 0,
    postPos: form.postPos,
    poolSize: form.poolSize.trim(),
    carvedAt: dateToIso(form.carvedAt),
    carver: form.carver.trim(),
    remark: form.remark.trim(),
  };
}

export function lacquerFormToRecord(form: LacquerDraftForm): Record<string, unknown> {
  return {
    guqinNo: form.guqinNo.trim(),
    mixRatio: form.mixRatio.trim(),
    curingTemp: Number(form.curingTemp) || 0,
    curingHumidity: Number(form.curingHumidity) || 0,
    polishGrit: Number(form.polishGrit) || 0,
    layerThickness: Number(form.layerThickness) || 0,
    appliedAt: dateToIso(form.appliedAt),
    operator: form.operator.trim(),
    remark: form.remark.trim(),
  };
}

export function stringingFormToRecord(form: StringingDraftForm): Record<string, unknown> {
  return {
    guqinNo: form.guqinNo.trim(),
    stringType: form.stringType,
    nut: form.nut.trim(),
    stringGap: Number(form.stringGap) || 0,
    sanNote: form.tone.sanNote.trim(),
    anNote: form.tone.anNote.trim(),
    fanNote: form.tone.fanNote.trim(),
    nineVirtues: form.tone.nineVirtues.trim(),
    defects: form.defects.length ? [...form.defects] : ['无'],
    strungAt: dateToIso(form.strungAt),
    operator: form.operator.trim(),
  };
}

/* ---------------- 冲突弹窗里的双方值展示 ---------------- */

const DATE_KEYS = new Set(['receivedAt', 'carvedAt', 'appliedAt', 'strungAt']);

export function formatFieldValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）';
  if (DATE_KEYS.has(key) && typeof value === 'string') return value.slice(0, 10);
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  return String(value);
}
