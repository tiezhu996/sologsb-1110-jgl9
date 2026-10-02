/* eslint-disable no-console */
import 'fake-indexeddb/auto';

// Node 环境垫片
const mem = new Map<string, string>();
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
  get length() {
    return mem.size;
  },
  clear: () => mem.clear(),
  getItem: (k: string) => mem.get(k) ?? null,
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  removeItem: (k: string) => void mem.delete(k),
  setItem: (k: string, v: string) => void mem.set(k, v),
};

import assert from 'node:assert';
import Dexie from 'dexie';
import { createPinia, setActivePinia } from 'pinia';
import { db, DB_NAME } from '../src/utils/db';
import { useBoardStore } from '../src/stores/boardStore';
import { useChamberStore } from '../src/stores/chamberStore';
import { useLacquerStore } from '../src/stores/lacquerStore';
import { useStringingStore } from '../src/stores/stringingStore';
import { useDraftStore } from '../src/stores/draftStore';
import { boardToForm, chamberToForm, lacquerToForm, stringingToForm, emptyLacquerForm } from '../src/utils/forms';
import { ConflictError } from '../src/utils/conflict';
import { buildBackup } from '../src/utils/export';
import { normalizeArchives } from '../src/utils/archive';
import type { WoodBoard } from '../src/types/wood-board';
import type { SoundChamber } from '../src/types/sound-chamber';
import type { LacquerLayer } from '../src/types/lacquer-layer';
import type { Stringing } from '../src/types/stringing';

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const now = new Date().toISOString();
const boardSeed: WoodBoard = {
  id: 'b1', boardNo: 'MB-1', guqinNo: 'Q-1', part: '面板', species: '桐木', dryYears: 5,
  thicknessMm: 30, grain: '直纹', defect: '无', receivedAt: now, rev: 1, updatedAt: now,
};
const chamberSeed: SoundChamber = {
  id: 'c1', guqinNo: 'Q-1', nayinThickness: 15, longchiThickness: 13, fengzhaoThickness: 14,
  chamberDepth: 26, postPos: '天柱中', poolSize: '200×22', carvedAt: now, carver: '周砚秋',
  rev: 1, updatedAt: now,
};
const layerSeed: LacquerLayer = {
  id: 'l1', guqinNo: 'Q-1', seq: 1, mixRatio: '1:1', curingTemp: 25, curingHumidity: 78,
  polishGrit: 320, layerThickness: 0.1, totalThickness: 0.1, appliedAt: now, operator: '林听雪',
  rev: 1, updatedAt: now,
};
const stringingSeed: Stringing = {
  id: 's1', guqinNo: 'Q-1', stringType: '丝弦', nut: '红木雁足', stringGap: 17,
  sanNote: '散音A', anNote: '按音A', fanNote: '泛音A', nineVirtues: '九德A', defects: ['无'],
  strungAt: now, operator: '周砚秋', noteVersions: [], rev: 1, updatedAt: now,
};

async function main() {
  /* ---------- v2 → v3 升级：旧数据回填 rev=1 / updatedAt ---------- */
  await test('schema v3 升级：v2 旧数据按初版 rev=1 兼容并回填 updatedAt', async () => {
    const oldDb = new Dexie(DB_NAME);
    oldDb.version(1).stores({
      boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, postPos, carvedAt',
      lacquers: 'id, guqinNo, seq, appliedAt',
      stringings: 'id, guqinNo, stringType, strungAt',
      meta: 'key',
    });
    oldDb.version(2).stores({
      boards: 'id, boardNo, guqinNo, part, species, grain, receivedAt',
      chambers: 'id, guqinNo, postPos, carvedAt',
      lacquers: 'id, guqinNo, seq, [guqinNo+seq], appliedAt',
      stringings: 'id, guqinNo, stringType, strungAt',
      meta: 'key',
    });
    await oldDb.table('boards').put({
      id: 'old-b', boardNo: 'MB-old', guqinNo: 'Q-old', part: '面板', species: '桐木',
      dryYears: 5, thicknessMm: 30, grain: '直纹', defect: '无', receivedAt: now,
    });
    await oldDb.table('lacquers').put({
      id: 'old-l', guqinNo: 'Q-old', seq: 1, mixRatio: '1:1', curingTemp: 25, curingHumidity: 78,
      polishGrit: 320, layerThickness: 0.1, totalThickness: 0, appliedAt: now, operator: '林听雪',
    });
    await oldDb.close();

    // 打开主 db（schema v3）触发升级
    const boards = await db.table('boards').toArray();
    assert.strictEqual(boards[0].rev, 1);
    assert.strictEqual(boards[0].updatedAt, now);
    const layers = await db.table('lacquers').toArray();
    assert.strictEqual(layers[0].rev, 1);
    assert.strictEqual(layers[0].updatedAt, now);
    // 清掉旧库数据，进入后续核对场景
    await db.table('boards').clear();
    await db.table('lacquers').clear();
  });

  setActivePinia(createPinia());
  await db.table('boards').clear();
  await db.table('chambers').clear();
  await db.table('lacquers').clear();
  await db.table('stringings').clear();
  await db.table('drafts').clear();
  await Promise.all([
    db.boards.put(boardSeed),
    db.chambers.put(chamberSeed),
    db.lacquers.put(layerSeed),
    db.stringings.put(stringingSeed),
  ]);

  const boardStore = useBoardStore();
  const chamberStore = useChamberStore();
  const lacquerStore = useLacquerStore();
  const stringingStore = useStringingStore();
  const draftStore = useDraftStore();
  await Promise.all([
    boardStore.hydrate(),
    chamberStore.hydrate(),
    lacquerStore.hydrate(),
    stringingStore.hydrate(),
    draftStore.hydrate(),
  ]);

  /* ---------- 板材：字段冲突 + 自动合并 + 重试 ---------- */
  await test('板材：页签A改厚度先提交成功，rev+1', async () => {
    const formA = { ...boardToForm(boardSeed), thicknessMm: 40 };
    const saved = await boardStore.commitBoard({ mode: 'edit', sessionId: 'b1', form: formA, base: boardSeed });
    assert.strictEqual(saved.rev, 2);
    assert.strictEqual(saved.thicknessMm, 40);
  });

  await test('板材：页签B基于旧版改备注（不同字段）自动合并，不冲突且保留A的厚度', async () => {
    const formB = { ...boardToForm(boardSeed), remark: '纹理佳' };
    const saved = await boardStore.commitBoard({ mode: 'edit', sessionId: 'b1', form: formB, base: boardSeed });
    assert.strictEqual(saved.rev, 3);
    assert.strictEqual(saved.thicknessMm, 40);
    assert.strictEqual(saved.remark, '纹理佳');
  });

  await test('板材：页签C基于旧版改厚度（同字段不同值）提交失败，列出双方改动且草稿/档案保留', async () => {
    const formC = { ...boardToForm(boardSeed), thicknessMm: 50 };
    await assert.rejects(
      () => boardStore.commitBoard({ mode: 'edit', sessionId: 'b1', form: formC, base: boardSeed }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        assert.strictEqual(err.conflict.issue, 'fields');
        assert.strictEqual(err.conflict.currentRev, 3);
        const f = err.conflict.fields.find((x) => x.key === 'thicknessMm');
        assert.ok(f, '应列出 thicknessMm 冲突');
        assert.strictEqual(f!.base, 30);
        assert.strictEqual(f!.theirs, 40);
        assert.strictEqual(f!.ours, 50);
        return true;
      },
    );
    const archived = await db.boards.get('b1');
    assert.strictEqual(archived?.thicknessMm, 40); // 正式档案未被覆盖
    assert.strictEqual(archived?.rev, 3);
  });

  await test('板材：C选择本页签厚度重试成功，备注仍保留B的改动', async () => {
    const formC = { ...boardToForm(boardSeed), thicknessMm: 50 };
    const saved = await boardStore.commitBoard({
      mode: 'edit', sessionId: 'b1', form: formC, base: boardSeed,
      resolutions: { thicknessMm: 'ours' }, expectedRev: 3,
    });
    assert.strictEqual(saved.rev, 4);
    assert.strictEqual(saved.thicknessMm, 50);
    assert.strictEqual(saved.remark, '纹理佳');
  });

  await test('板材：记录已被删除时抛 record-deleted', async () => {
    await db.boards.put({ ...boardSeed, id: 'b2', boardNo: 'MB-2' });
    await boardStore.hydrate();
    await db.boards.delete('b2');
    const form = { ...boardToForm(boardSeed), boardNo: 'MB-2' };
    await assert.rejects(
      () => boardStore.commitBoard({ mode: 'edit', sessionId: 'b2', form, base: { ...boardSeed, id: 'b2', boardNo: 'MB-2' } }),
      (err: unknown) => err instanceof ConflictError && err.conflict.issue === 'record-deleted',
    );
  });

  /* ---------- 槽腹：不同字段自动合并 ---------- */
  await test('槽腹：两页签分别改纳音/龙池，后提交者自动合并双方改动', async () => {
    const formA = { ...chamberToForm(chamberSeed), nayinThickness: 20 };
    const a = await chamberStore.commitChamber({ mode: 'edit', sessionId: 'c1', form: formA, base: chamberSeed });
    assert.strictEqual(a.rev, 2);
    const formB = { ...chamberToForm(chamberSeed), longchiThickness: 9 };
    const b = await chamberStore.commitChamber({ mode: 'edit', sessionId: 'c1', form: formB, base: chamberSeed });
    assert.strictEqual(b.rev, 3);
    assert.strictEqual(b.nayinThickness, 20);
    assert.strictEqual(b.longchiThickness, 9);
  });

  await test('槽腹：同字段冲突时双方值都列出', async () => {
    const base2 = await db.chambers.get('c1')!;
    const formA = { ...chamberToForm(base2), chamberDepth: 30 };
    await chamberStore.commitChamber({ mode: 'edit', sessionId: 'c1', form: formA, base: base2 });
    const formC = { ...chamberToForm(base2), chamberDepth: 22 };
    await assert.rejects(
      () => chamberStore.commitChamber({ mode: 'edit', sessionId: 'c1', form: formC, base: base2 }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictError);
        const f = err.conflict.fields.find((x) => x.key === 'chamberDepth');
        assert.strictEqual(f?.theirs, 30);
        assert.strictEqual(f?.ours, 22);
        return true;
      },
    );
  });

  await test('槽腹：新增时琴号已被占用则冲突失败且不写入', async () => {
    const form = { ...chamberToForm(chamberSeed), carver: '某人' };
    const before = await db.chambers.count();
    await assert.rejects(
      () => chamberStore.commitChamber({ mode: 'create', sessionId: 'new1', form, base: null }),
      (err: unknown) => err instanceof ConflictError && err.conflict.issue === 'guqin-taken',
    );
    assert.strictEqual(await db.chambers.count(), before);
  });

  /* ---------- 髹漆：并发追加不串遍次、累计厚度正确、编辑冲突可重试 ---------- */
  await test('髹漆：连续追加两遍，seq 自增且累计厚度按正式档案重算', async () => {
    const f1 = { ...emptyLacquerForm(), guqinNo: 'Q-9', operator: '林听雪', layerThickness: 0.1 };
    const l1 = await lacquerStore.commitLayer({ mode: 'create', sessionId: 'n1', form: f1, base: null });
    assert.strictEqual(l1.seq, 1);
    assert.strictEqual(Number(l1.totalThickness.toFixed(2)), 0.1);
    const f2 = { ...emptyLacquerForm(), guqinNo: 'Q-9', operator: '林听雪', layerThickness: 0.2 };
    const l2 = await lacquerStore.commitLayer({ mode: 'create', sessionId: 'n2', form: f2, base: null });
    assert.strictEqual(l2.seq, 2);
    assert.strictEqual(Number(l2.totalThickness.toFixed(2)), 0.3);
  });

  await test('髹漆：旧版编辑改配比与对方改厚度不冲突，自动合并', async () => {
    const formA = { ...lacquerToForm(layerSeed), polishGrit: 600 };
    const a = await lacquerStore.commitLayer({ mode: 'edit', sessionId: 'l1', form: formA, base: layerSeed });
    assert.strictEqual(a.rev, 2);
    const formB = { ...lacquerToForm(layerSeed), mixRatio: '1:2' };
    const b = await lacquerStore.commitLayer({ mode: 'edit', sessionId: 'l1', form: formB, base: layerSeed });
    assert.strictEqual(b.rev, 3);
    assert.strictEqual(b.mixRatio, '1:2');
    assert.strictEqual(b.polishGrit, 600);
  });

  /* ---------- 上弦：不同评语段落互不覆盖，历史版本记录现行值 ---------- */
  await test('上弦：两页签分别改散音/按音，后提交保留双方评语并留存历史版本', async () => {
    const formA = { ...stringingToForm(stringingSeed), tone: { ...stringingToForm(stringingSeed).tone, sanNote: '散音B改' } };
    const a = await stringingStore.commitStringing({ mode: 'edit', sessionId: 's1', form: formA, base: stringingSeed });
    assert.strictEqual(a.rev, 2);
    const formB = { ...stringingToForm(stringingSeed), tone: { ...stringingToForm(stringingSeed).tone, anNote: '按音B改' } };
    const b = await stringingStore.commitStringing({ mode: 'edit', sessionId: 's1', form: formB, base: stringingSeed });
    assert.strictEqual(b.rev, 3);
    assert.strictEqual(b.sanNote, '散音B改');
    assert.strictEqual(b.anNote, '按音B改');
    assert.strictEqual(b.fanNote, '泛音A');
    assert.ok(b.noteVersions.length >= 1, '应留存改动前现行评语为历史版本');
    assert.strictEqual(b.noteVersions[0].sanNote, '散音B改');
  });

  await test('上弦：新增同琴号记录按琴号占用冲突', async () => {
    const form = stringingToForm(stringingSeed);
    await assert.rejects(
      () => stringingStore.commitStringing({ mode: 'create', sessionId: 'n3', form, base: null }),
      (err: unknown) => err instanceof ConflictError && err.conflict.issue === 'guqin-taken',
    );
  });

  /* ---------- 草稿与正式档案分库，导出/进度只认正式档案 ---------- */
  await test('草稿：保存到 drafts 表且不出现在正式表/导出备份中', async () => {
    await draftStore.save({
      kind: 'board',
      mode: 'edit',
      sessionId: 'b1',
      guqinNo: 'Q-1',
      payload: { kind: 'board', form: boardToForm(boardSeed) },
      baseRecord: boardSeed,
      baseRev: 1,
    });
    const drafts = await db.drafts.toArray();
    assert.strictEqual(drafts.length, 1);
    assert.ok(drafts[0].id.includes(':board:b1'));
    const backup = await buildBackup();
    assert.deepStrictEqual(Object.keys(backup).sort(), ['app', 'boards', 'chambers', 'exportedAt', 'lacquers', 'schemaVersion', 'stringings'].sort());
    assert.ok(!('drafts' in backup), '备份不得包含草稿');
    // 草稿不影响正式档案：库里只有 b1（b2 已删），草稿在 drafts 表
    assert.strictEqual(await db.boards.count(), 1);
    assert.strictEqual(await db.drafts.count(), 1);
  });

  await test('兼容：缺少 rev/updatedAt 的旧数据按初版归一化', async () => {
    const normalized = normalizeArchives(
      [{ id: 'old', boardNo: 'MB-x', guqinNo: 'Q-x', part: '底板', species: '梓木', dryYears: 1, thicknessMm: 10, grain: '直纹', defect: '无', receivedAt: now }],
      [],
      [],
      [],
    );
    assert.strictEqual(normalized.boards[0].rev, 1);
    assert.strictEqual(normalized.boards[0].updatedAt, now);
  });

  console.log(`\n${passed} 项核对全部通过`);
}

void main();
