import type { WoodBoard, BoardPart, WoodSpecies, WoodGrain, WoodDefect } from './wood-board';
import type { SoundChamber, PostPos } from './sound-chamber';
import type { LacquerLayer } from './lacquer-layer';
import type { Stringing, StringType, StringDefect, ToneDraft } from './stringing';

/** 四类工序草稿 */
export type DraftKind = 'board' | 'chamber' | 'lacquer' | 'stringing';

/** create=新增草稿（尚无正式档案）；edit=基于某条正式档案的编辑草稿 */
export type DraftMode = 'create' | 'edit';

/** 板材登记表单草稿（日期保持 YYYY-MM-DD，提交时再转 ISO） */
export interface BoardDraftForm {
  boardNo: string;
  guqinNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
  receivedAt: string;
  remark: string;
}

/** 槽腹表单草稿 */
export interface ChamberDraftForm {
  guqinNo: string;
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
  carvedAt: string;
  carver: string;
  remark: string;
}

/** 髹漆遍次表单草稿 */
export interface LacquerDraftForm {
  guqinNo: string;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt: string;
  operator: string;
  remark: string;
}

/** 上弦表单草稿（含散音/按音/泛音/九德文字评语） */
export interface StringingDraftForm {
  guqinNo: string;
  stringType: StringType;
  nut: string;
  stringGap: number;
  defects: StringDefect[];
  strungAt: string;
  operator: string;
  tone: ToneDraft;
}

/** 四类表单的联合包装，kind 与 ProcessDraft.kind 一致 */
export type DraftPayload =
  | { kind: 'board'; form: BoardDraftForm }
  | { kind: 'chamber'; form: ChamberDraftForm }
  | { kind: 'lacquer'; form: LacquerDraftForm }
  | { kind: 'stringing'; form: StringingDraftForm };

/** 打开编辑时的正式档案快照（三向比对的基线）；新增草稿为 null */
export type DraftBaseRecord = WoodBoard | SoundChamber | LacquerLayer | Stringing | null;

/**
 * 工序草稿：与正式工序档案（boards/chambers/lacquers/stringings 四张表）分开保存。
 * 每条草稿按 tabId 归属页签，两个页签同编同一张琴互不覆盖；草稿不进入首页进度、导出备份与异常统计。
 */
export interface ProcessDraft {
  /** 草稿主键：`${tabId}:${kind}:${sessionId}` */
  id: string;
  /** 所属浏览器页签（sessionStorage 生成，刷新保留、另开页签不同） */
  tabId: string;
  kind: DraftKind;
  mode: DraftMode;
  /**
   * 草稿会话标识：edit 模式为所编辑的正式档案 id；create 模式为每次打开登记弹窗时生成的临时 id。
   * 同一会话内自动保存始终覆盖同一条草稿，不会每次输入都新增。
   */
  sessionId: string;
  /** edit 模式下所编辑的正式档案 id；create 模式为空串 */
  targetId: string;
  /** 琴号，用于草稿箱列表展示 */
  guqinNo: string;
  /** 表单内容 */
  payload: DraftPayload;
  /** 页面打开（开始编辑）时的正式档案快照；create 模式为 null */
  baseRecord: DraftBaseRecord;
  /** 打开时正式档案版本号（baseRecord.rev）；create 模式为 0 */
  baseRev: number;
  /** 草稿创建时间 ISO */
  createdAt: string;
  /** 草稿最近自动保存时间 ISO */
  updatedAt: string;
}

export const DRAFT_KIND_LABELS: Record<DraftKind, string> = {
  board: '板材',
  chamber: '槽腹',
  lacquer: '髹漆',
  stringing: '上弦',
};
