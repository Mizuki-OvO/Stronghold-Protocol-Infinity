// 无尽模式's shop (docs/ENDLESS.md): level 7, unchanged operator/item odds, one special-item slot, and the
// consumable special items whose permanent stat bonus rides on the piece after the item is destroyed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import {
  GameData, endlessItemRecord, ENDLESS_ITEM_KIND, ENDLESS_STAT_BUFF_KEY, ENDLESS_STAT_KEYS, ENDLESS_EQUIP_KEY,
} from '../../server/match/gamedata.js';
import { isShopItem } from '../../server/sim/simdata.js';
import { makeMatch, DATA, give, giveItem } from './harness.js';

/**
 * Drive a match into the endless loop at round 16 and leave it in a real PREP phase of that wave, so the ordinary
 * `ps.equip` path (which is phase-gated) can be exercised.
 */
function endlessShopMatch({ level = 6, wave = 1, seed = 51, prep = true } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, bots: 0, seed });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  m.answerEndless(m.players.get('p_0'), true);
  // the vote already ran _beginEndless, which flipped gd.endlessActive and registered the special items
  assert.equal(m.gd.endlessActive, true, 'the loop is live');
  const first = m.gd.endlessFirstRound();
  m.round = first + wave - 1;
  const ps = m.players.get('p_0');
  if (prep) {
    // a real prep of the endless wave (the deploy field, timers and gating all follow the live phase)
    m.phase = PHASE.PREP;
    ps.shop.level = level;
  } else {
    ps.shop.level = level;
  }
  return { h, m, ps };
}

// ---------------------------------------------------------------------------------------------------
// 1. the item records
// ---------------------------------------------------------------------------------------------------

test('endless shop items are complete, consumable, excluded from ordinary draws', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  const specs = gd.endlessCfg.shop.items;
  assert.equal(specs.length, 6, 'six special items: five stat items + the 动员令 capstone');
  const STAT_ITEMS = specs.filter((s) => !s.deployCapAtLeast);
  assert.equal(STAT_ITEMS.length, 5, 'five of them carry a stat');

  for (const spec of specs) {
    const rec = endlessItemRecord(spec);
    assert.ok(rec, `${spec.id} builds a record`);
    assert.equal(rec.itemType, 'EQUIP', `${spec.id} is equipment`);
    assert.equal(rec.kind, ENDLESS_ITEM_KIND, `${spec.id} is consumed on equip`);
    assert.equal(rec.shopExcluded, true, `${spec.id} never appears in an ordinary item draw`);
    assert.equal(isShopItem(rec), false, `${spec.id} is not a shop item for the normal pools`);
    assert.ok(rec.id.startsWith('chess_item_'), `${spec.id} looks like an item id`);
  }
  // the five stat items share the one shape (3 funds, the global stat buff); the capstone is its own thing
  for (const spec of STAT_ITEMS) {
    const rec = endlessItemRecord(spec);
    assert.equal(rec.price, 3, `${spec.id} costs 3`);
    assert.equal(rec.buffs[0].key, 'env_gbuff_new_with_verify');
    assert.equal(rec.buffs[0].bbStr.key, ENDLESS_STAT_BUFF_KEY, `${spec.id} carries the stat buff key`);
  }
  const capstone = endlessItemRecord(specs.find((s) => s.deployCapAtLeast));
  assert.equal(capstone.price, 10, 'the capstone costs 10');
  assert.equal(capstone.deployCapAtLeast, 10);
  assert.equal(Object.keys(capstone.mods).length, 0, 'and carries no stat');
});

test('the five stat items cover five distinct stats, one each', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  // the 动员令 capstone carries no stat, so it is not part of this set
  const recs = gd.endlessCfg.shop.items.filter((s) => !s.deployCapAtLeast).map((s) => endlessItemRecord(s));
  const seenKeys = recs.map((r) => Object.keys(r.mods).sort().join(','));
  assert.equal(new Set(seenKeys).size, 5, `five distinct stat sets (got ${seenKeys.join(' | ')})`);
  // the exact numbers from the spec
  const byMod = {};
  for (const r of recs) for (const [k, v] of Object.entries(r.mods)) byMod[k] = v;
  assert.equal(byMod.hpPct, 0.03, '生命值 +3%');
  assert.equal(byMod.aspd, 15, '攻速 +15');
  assert.equal(byMod.defPct, 0.03, '防御 +3%');
  assert.equal(byMod.resFlat, 1, '法抗 +1');
  assert.equal(byMod.atkPct, 0.03, '攻击 +3% (the spec wrote 生命/血量 twice; the fifth is attack)');
  for (const k of Object.keys(byMod)) assert.ok(ENDLESS_STAT_KEYS.includes(k), `${k} is a known mods key`);
});

test('the items resolve through gd.item and carry a price', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  for (const spec of gd.endlessCfg.shop.items) {
    const rec = gd.item(spec.id);
    assert.ok(rec, `gd.item(${spec.id}) resolves`);
    const want = Number.isFinite(spec.price) ? spec.price : 3;
    assert.equal(gd.itemPrice(spec.id), want, `${spec.id} prices at ${want}`);
  }
  // and they are really NOT in the ordinary per-tier pools
  const inPools = Object.values(gd.shopItemsByTier).flat();
  for (const spec of gd.endlessCfg.shop.items) assert.ok(!inPools.includes(spec.id), `${spec.id} is not in shopItemsByTier`);
});

// ---------------------------------------------------------------------------------------------------
// 2. shop level 7 and the odds
// ---------------------------------------------------------------------------------------------------

test('shop level 7 exists ONLY while the endless loop is live', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  assert.equal(gd.maxShopLevel, 6, 'level 6 before the loop');
  assert.equal(gd.endlessShopOpen, false);
  gd.setEndlessActive(true);
  assert.equal(gd.maxShopLevel, 7, 'level 7 inside the loop');
  assert.equal(gd.endlessShopOpen, true);
  assert.equal(gd.upgradeBase(6), gd.endlessCfg.shop.priceToMaxLevel, '6 → 7 has a price');
  assert.equal(gd.upgradeBase(7), null, 'and 7 is the top');
  assert.equal(gd.endlessShopItems().length, 6, 'the special items are offered');
});

test('the 6 → 7 upgrade costs 20, and then rides the per-round discount like every other level', () => {
  const { h, m, ps } = endlessShopMatch({ level: 6, prep: false });
  const gd = m.gd;
  // the official ladder is untouched
  assert.deepEqual(gd.upgradePrices(), [5, 8, 11, 12, 13], 'the five official steps are unchanged');
  // the endless-only step is deliberately steeper than the ladder's last value (13)
  assert.equal(gd.endlessCfg.shop.priceToMaxLevel, 20, 'the endless capstone opens at 20');
  assert.equal(gd.upgradeBase(6), 20, '6 → 7 costs 20');

  // PlayerState.startRound decrements the standing price by 1 every round from R2 on (the official rule). The endless
  // step must go through the same path, so a 6-level player sees 20 → 19 → 18 …
  ps.shop.level = 6;
  ps.shop.upgradePrice = gd.upgradeBase(6);
  assert.equal(ps.shop.upgradePrice, 20, 'the standing price after reaching level 6');
  const seq = [];
  for (let r = 2; r <= 6; r++) { ps.startRound(r); seq.push(ps.shop.upgradePrice); }
  assert.deepEqual(seq, [19, 18, 17, 16, 15], `one funds per round (got ${seq.join()})`);

  // it never goes negative, however long the loop runs
  ps.shop.upgradePrice = 2;
  for (let r = 20; r <= 30; r++) ps.startRound(r);
  assert.equal(ps.shop.upgradePrice, 0, 'clamped at 0');
  void h;
  m.dispose();
});

test('the special items are NOT offered outside the loop', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  assert.deepEqual(gd.endlessShopItems(), [], 'no special items before the loop');
  assert.equal(gd.endlessSpecialSlots(6), 0);
  assert.equal(gd.endlessSpecialSlots(7), 0, 'and no level 7 either');
  assert.equal(gd.maxShopLevel, 6, 'the official top level');
  gd.setEndlessActive(true);
  assert.equal(gd.maxShopLevel, 7, 'the loop opens level 7');
});

test('operator and item odds at level 7 are exactly level 6 odds', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  gd.setEndlessActive(true);
  // the roll uses the shop level as `maxTier`; nothing above tier 6 exists, so 7 cannot open new tiers
  for (const t of [7, 8]) {
    assert.equal(gd.shopItemsByTier[t], undefined, `no tier ${t} items`);
    assert.ok(!gd.visibleChess.some((id) => gd.chess(id).tier === t), `no tier ${t} operators`);
  }
  // the highest tier that exists is 6, so levels 6 and 7 draw from the same pool
  const maxItemTier = Math.max(...Object.keys(gd.shopItemsByTier).map(Number));
  const maxChessTier = Math.max(...gd.visibleChess.map((id) => gd.chess(id).tier));
  assert.equal(maxItemTier, 6, 'items top out at tier 6');
  assert.equal(maxChessTier, 6, 'operators top out at tier 6');
  assert.equal(gd.shopSlots(7).chess, gd.shopSlots(6).chess, 'the same operator slot count');
  assert.equal(gd.shopSlots(7).item, gd.shopSlots(6).item, 'and the same ordinary item slot count');
});

// ---------------------------------------------------------------------------------------------------
// 3. the special slot
// ---------------------------------------------------------------------------------------------------

test('level 7 adds one slot that only ever offers a special item', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  assert.equal(m.gd.endlessSpecialSlots(7), 1, 'one special slot');
  ps.rollShop();
  const specials = ps.shop.slots.filter((s) => s && s.special);
  assert.equal(specials.length, 1, 'exactly one special slot rolled');
  assert.ok(m.gd.isEndlessShopItem(specials[0].id), `the slot holds a special item (${specials[0].id})`);
  assert.equal(specials[0].basePrice, 3, 'priced at 3');
  // the ordinary slots keep the level-6 layout (5 chess + 1 item)
  const { chess, item } = m.gd.shopSlots(7);
  assert.equal(chess, 5, 'level 7 operators = level 6 operators');
  assert.equal(item, 1, 'and so do the ordinary item slots');
  const ordinary = ps.shop.slots.filter((s) => s && !s.special);
  assert.equal(ordinary.length, chess + item, 'the rest is the ordinary level-6 layout');
  for (const s of ps.shop.slots) if (s && s.kind === 'item' && !s.special) {
    assert.ok(!m.gd.isEndlessShopItem(s.id), 'an ordinary item slot never holds a special item');
  }
  m.dispose();
});

test('level 6 (and below) has no special slot', () => {
  const { h, m, ps } = endlessShopMatch({ level: 6 });
  ps.rollShop();
  assert.equal(ps.shop.slots.filter((s) => s && s.special).length, 0, 'no special slot at level 6');
  void h;
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 4. the consumable and its permanent bonus
// ---------------------------------------------------------------------------------------------------

test('equipping a special item destroys it and folds its stats into the operator permanently', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const special = gd.endlessShopItems()[0];
  // an operator on the board to receive it
  const chessId = gd.visibleChess[0];
  const piece = give(m, ps, chessId, 'board', [9, 1]);
  assert.equal(piece.meta?.stats, undefined, 'no bonus before equipping');

  // an instance of the special item in the hand
  const item = ps.newPiece('item', special.id);
  ps.hand[ps.hand.findIndex((x) => x == null)] = item;
  ps.recompute();

  const res = ps.equip(item.uid, piece.uid);
  assert.deepEqual(res, { ok: true }, `equip accepted (${JSON.stringify(res)})`);

  // the item is gone (consumed), the bonus is on the piece
  const after = ps.find(item.uid);
  assert.ok(!after || after.area !== 'equipped', 'the item is not worn: it was destroyed on equip');
  const stats = piece.meta.stats;
  assert.ok(stats && Object.keys(stats).length, 'the piece carries the bonus');
  for (const [k, v] of Object.entries(special.mods)) assert.equal(stats[k], v, `piece meta ${k}`);
  void h;
  m.dispose();
});

test('the bonus survives the piece and accumulates when a second item is used', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const piece = give(m, ps, gd.visibleChess[0], 'board', [9, 1]);
  const items = gd.endlessShopItems();
  const use = (rec) => {
    const it = ps.newPiece('item', rec.id);
    ps.hand[ps.hand.findIndex((x) => x == null)] = it;
    ps.recompute();
    assert.deepEqual(ps.equip(it.uid, piece.uid), { ok: true });
  };
  use(items[0]);                                   // +3% HP
  assert.equal(piece.meta.stats.hpPct, 0.03);
  use(items[0]);                                   // +3% HP again
  assert.equal(piece.meta.stats.hpPct, 0.06, 'two copies stack additively');
  use(items[2]);                                   // +3% def
  assert.equal(piece.meta.stats.hpPct, 0.06, 'the other stat is untouched');
  assert.equal(piece.meta.stats.defPct, 0.03, 'and the new one is added');
  void h;
  m.dispose();
});

test('battleInput carries the bonus to the field, and only for the operators that have one', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const boosted = give(m, ps, gd.visibleChess[0], 'board', [9, 1]);
  const plain = give(m, ps, gd.visibleChess[1] || gd.visibleChess[0], 'board', [9, 2]);
  const rec = gd.endlessShopItems()[1];            // +15 attack speed
  const it = ps.newPiece('item', rec.id);
  ps.hand[ps.hand.findIndex((x) => x == null)] = it;
  ps.recompute();
  assert.deepEqual(ps.equip(it.uid, boosted.uid), { ok: true });

  const input = ps.battleInput({ side: 'L' });
  const uBoost = input.units.find((u) => u.uid === boosted.uid);
  const uPlain = input.units.find((u) => u.uid === plain.uid);
  assert.ok(uBoost, 'the boosted operator is on the field');
  assert.deepEqual(uBoost.statBonus, { aspd: 15 }, 'the bonus travels as plain data');
  assert.equal(uPlain.statBonus, undefined, 'a plain operator carries none');
  void h;
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 6b. THE BONUS MUST ACTUALLY REACH THE FIELD
//
// The pipeline is: equip → PlayerState.addPieceStat (piece.meta.stats) → battleInput adds `unit.statBonus`
// → Battle._createAllyFromInput copies it onto the battle unit → items/battle.js installStatBonus turns it into a
// persistent buff → units.js recomputes `u.s` from the buff mods. TWO separate links were broken and both were
// invisible to the older tests above, which only checked that the data was *sent*:
//   * Battle dropped `statBonus` when building the unit from the input
//   * installStatBonus ran from the Battle constructor, i.e. while every ally was still alive:false, and addBuff
//     refuses a non-alive unit unless the buff allows it → the buff was silently discarded
// These tests build the same battle the in-game stat preview builds (Match._unitStatsOf) and read the real numbers.
// ---------------------------------------------------------------------------------------------------

/** Equip the only board operator with `itemId` through the real path, then build+start the preview/combat battle. */
function boardWithItem({ itemId, seed = 61 }) {
  const { h, m, ps } = endlessShopMatch({ level: 7, seed });
  const gd = m.gd;
  const rec = gd.chess(gd.visibleChess[0]);
  // the SAME operator twice: one control, one treated. Another visibleChess entry would be a different operator with
  // different base stats, which would measure the wrong thing.
  const control = give(m, ps, rec.chessId ?? gd.visibleChess[0], 'board', [9, 1]);
  const treated = give(m, ps, rec.chessId ?? gd.visibleChess[0], 'board', [9, 2]);
  if (itemId) {
    const it = giveItem(m, ps, itemId);
    assert.deepEqual(ps.equip(it.uid, treated.uid), { ok: true }, `${itemId} equips`);
  }
  // exactly what Match._unitStatsOf does, then start it so the units deploy and their stats settle
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  const battle = m.newBattle({
    seed: 1, kind: 'normal', modeId: m.modeId, round: m.round, stageId: m.stageId,
    rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 60,
    players: [input], spawns: [], routes: [], sharedBoss: null,
    flags: { layerGainsEnabled: true }, fieldId: 'test:stats', recordEvents: false,
  });
  battle.start();
  const find = (uid) => (battle.allyUnits || []).find((u) => u.uid === uid);
  const c = find(control.uid), t = find(treated.uid);
  assert.ok(c && t, 'both operators are on the field');
  return { h, m, ps, control: c, treated: t };
}

test('the five stat items really change the operator’s battle stats (not just the carried data)', () => {
  // [item id, the u.s field it must move, expected factor or delta, human name]
  const CASES = [
    ['chess_item_endless_01_e_a', 'maxHp', { mul: 1.03 }, '无尽核心 生命值+3%'],
    ['chess_item_endless_02_e_a', 'aspd', { add: 15 }, '超频芯片 攻速+15'],
    ['chess_item_endless_03_e_a', 'def', { mul: 1.03 }, '壁垒发生器 防御+3%'],
    ['chess_item_endless_04_e_a', 'res', { add: 1 }, '奥术棱镜 法抗+1'],
    ['chess_item_endless_05_e_a', 'atk', { mul: 1.03 }, '猎手瞄准镜 攻击+3%'],
  ];
  for (const [itemId, field, want, label] of CASES) {
    const { m, control, treated } = boardWithItem({ itemId });
    const base = control.s[field];
    const got = treated.s[field];
    assert.ok(Number.isFinite(base), `${label}: the control has a numeric ${field}`);
    const expect = want.mul != null ? base * want.mul : base + want.add;
    assert.ok(Math.abs(got - expect) < 1e-6,
      `${label}: ${field} should be ${want.mul != null ? `${base}×${want.mul}` : `${base}+${want.add}`} = ${expect}, got ${got}`);
    // the bonus rides a real, persistent buff — not a one-off write
    assert.deepEqual(treated.statBonus && Object.keys(treated.statBonus), [treated.statBonus && Object.keys(treated.statBonus)[0]],
      `${label}: exactly one stat was folded in`);
    assert.ok(treated.buffs.some((b) => b.key === 'endless:pieceStats'),
      `${label}: the unit carries the endless stat buff`);
    assert.ok(treated.buffs.find((b) => b.key === 'endless:pieceStats').persist,
      `${label}: and it persists for the whole battle`);
    assert.equal(control.s[field], base, `${label}: the control operator is untouched`);
    assert.ok(!control.buffs.some((b) => b.key === 'endless:pieceStats'), `${label}: the control has no buff`);
    m.dispose();
  }
});

test('the bonus survives an unequipped-in-battle check: it is a buff, so it applies even though the item is gone', () => {
  const { m, treated, ps } = boardWithItem({ itemId: 'chess_item_endless_01_e_a' });
  // the consumable was destroyed on equip — the operator carries no items at all
  assert.deepEqual(treated.items, [], 'the consumable is gone');
  assert.ok(treated.buffs.some((b) => b.key === 'endless:pieceStats'), 'yet the bonus is on the unit');
  void ps;
  m.dispose();
});

test('two copies of the same stat item stack additively on the field', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7, seed: 71 });
  const gd = m.gd;
  const target = give(m, ps, gd.visibleChess[0], 'board', [9, 1]);
  for (let i = 0; i < 2; i++) {
    const it = giveItem(m, ps, 'chess_item_endless_01_e_a');   // 生命值 +3% twice
    assert.deepEqual(ps.equip(it.uid, target.uid), { ok: true }, `equip ${i + 1}`);
  }
  assert.equal(target.meta.stats.hpPct, 0.06, 'folded additively on the piece');
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  const battle = m.newBattle({
    seed: 1, kind: 'normal', modeId: m.modeId, round: m.round, stageId: m.stageId,
    rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 60,
    players: [input], spawns: [], routes: [], sharedBoss: null,
    flags: { layerGainsEnabled: true }, fieldId: 'test:stack', recordEvents: false,
  });
  battle.start();
  const t = (battle.allyUnits || []).find((u) => u.uid === target.uid);
  assert.ok(t, 'the operator is on the field');
  // `base` is the untouched chess stat, so the unit is its own control (another visibleChess entry is a DIFFERENT
  // operator with a different max HP — comparing against one would measure the wrong thing)
  assert.ok(Math.abs(t.s.maxHp - t.base.maxHp * 1.06) < 1e-6,
    `two +3% stack to +6% (base ${t.base.maxHp} → ${t.s.maxHp}, want ${t.base.maxHp * 1.06})`);
  assert.equal(t.buffs.filter((b) => b.key === 'endless:pieceStats').length, 1,
    'both land in ONE refreshed buff, not two');
  void h;
  m.dispose();
});


test('the equip handler is registered for every special item family', () => {
  const { h, m } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  for (const spec of gd.endlessCfg.shop.items) {
    const key = spec.id.replace(/_[ab]$/, '');       // itemKey: the family without the _a/_b suffix
    assert.ok(m.registry.has(`item:${key}`), `item:${key} is registered`);
  }
  // PlayerState.equip looks up the family key, and the handler really is the endless one
  const rec = gd.item(gd.endlessCfg.shop.items[0].id);
  assert.ok(rec && rec.mods, 'the record carries its mods');
  void h;
  void ENDLESS_EQUIP_KEY;
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 5. end to end through the real match flow
// ---------------------------------------------------------------------------------------------------

test('the whole chain works through settle(): T16 trades nothing, T17 trades, and the shop opens', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const first = gd.endlessFirstRound();

  // the loop really starts at 16 and the shop really reaches 7
  assert.equal(m.round, first, 'the loop opened at round 16');
  assert.equal(gd.maxShopLevel, 7, 'level 7 is reachable');
  assert.equal(gd.endlessShopOpen, true, 'and the special slot exists');
  assert.equal(gd.shopSlots(7).chess, 5, 'odds of level 6');

  // wave 16 (endless 1): no trade
  ps.layers = { [gd.bondIds[0]]: 100 };
  ps.lp = 10;                                      // must survive settle(): the elimination pass runs first
  ps.recompute();
  const lp0 = ps.lp;
  m.settle(null, null);
  assert.equal(ps.alive, true, 'the seat survived the wave');
  assert.equal(ps.layers[gd.bondIds[0]], 100, 'wave 16 took no layers');
  assert.equal(ps.lp, lp0, 'and gave no LP');

  // wave 17 (endless 2): the trade fires
  m.round = first + 1;
  const lp1 = ps.lp;
  m.settle(null, null);
  assert.equal(ps.layers[gd.bondIds[0]], 85, 'wave 17 cut the highest bond by 15');
  assert.equal(ps.lp, lp1 + 1, 'and granted +1 LP');
  m.dispose();
});

test('every special item carries a distinct emoji icon (no manifest art exists for them)', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  const recs = gd.endlessCfg.shop.items.map((s) => endlessItemRecord(s));
  const emojis = recs.map((r) => r.iconEmoji);
  for (const e of emojis) assert.ok(typeof e === 'string' && e.length, 'an emoji is set');
  assert.equal(new Set(emojis).size, recs.length, `every item has its own emoji (got ${emojis.join(' ')})`);
  // the record exposes it as `icon` too, so anything reading the plain field still shows something
  for (const r of recs) assert.equal(r.icon, r.iconEmoji, `${r.id}: icon mirrors iconEmoji`);
  // and the emoji is NOT a manifest trap id (those would collide with another item's art)
  for (const r of recs) assert.ok(!/^trap_/.test(r.iconEmoji), `${r.id}: not a trap id`);
});

test('every special item carries a real Chinese name in the official item-naming style', () => {
  const gd = new GameData(DATA, 'mode_single_abyss');
  gd.setEndlessActive(true);              // endlessShopItems() is gated on the loop being live
  const recs = gd.endlessShopItems();
  assert.equal(recs.length, 6, 'six special items');
  const names = recs.map((r) => r.name);
  for (const n of names) {
    // the official items are short noun phrases in pure Chinese (坚守盾牌 / 源石溶剂 / 紧急调度券 …): no @ref markup,
    // no 「强化组件·生命」-style prefix, no id leaking through
    assert.ok(typeof n === 'string' && n.length >= 2 && n.length <= 8, `2–8 chars (got ${n})`);
    assert.ok(/^[\u4e00-\u9fa5]+$/.test(n), `pure Chinese (got ${n})`);
    assert.ok(!n.includes('·'), `no prefix separator (got ${n})`);
    assert.ok(!/[_a-z0-9]/i.test(n), `no id fragment (got ${n})`);
  }
  assert.equal(new Set(names).size, recs.length, `every item has its own name (got ${names.join(' / ')})`);
  // and none of them collides with an official item's name (tools/sync-endless-items.mjs mirrors these records into
  // data/items.json for the client, so the official set must exclude that mirrored copy)
  const official = new Set(Object.values(DATA.items).filter((it) => it && !it.endless).map((it) => it.name).filter(Boolean));
  for (const n of names) assert.ok(!official.has(n), `${n} is not an official item name`);
  // the name is what the record exposes everywhere (name / effectName)
  for (const rec of recs) assert.equal(rec.effectName, rec.name, `${rec.id}: effectName mirrors name`);
  // the five STAT items stay one-per-item, each described in its own line (the capstone carries none)
  const stats = recs.filter((rec) => Object.keys(rec.mods).length).map((rec) => Object.keys(rec.mods).join(','));
  assert.equal(new Set(stats).size, 5, `five distinct stat sets (got ${stats.join(' | ')})`);
});

test('a bought special slot really puts the consumable in the shop and the roll is a real draw', () => {
  const { h, m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  // many rolls must always yield one of the offerable specials, never an ordinary item in the special slot
  const ids = new Set(gd.endlessShopItemsFor(ps).map((r) => r.id));
  for (let i = 0; i < 30; i++) {
    ps.rollShop();
    const sp = ps.shop.slots.filter((s) => s && s.special);
    assert.equal(sp.length, 1, `roll ${i}: one special slot`);
    assert.ok(ids.has(sp[0].id), `roll ${i}: ${sp[0].id} is one of the offerable special items`);
  }
  // and the shop's own price/level APIs accept it
  const one = gd.endlessShopItems()[0];
  assert.equal(gd.itemPrice(one.id), 3, 'priced at 3');
  void h;
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 7. 动员令 — the capstone that raises the deploy cap 9 → 10, gated on already having 9
// ---------------------------------------------------------------------------------------------------

const MOBILIZE = 'chess_item_endless_06_e_a';
const PERSONNEL_DOC = 'chess_item_6_08_e_a';   // the official item whose effect is exactly "最大可部署人数变为9"

/** Equip an item on the player's only board piece through the real, phase-gated path. */
function equipOnBoard(m, ps, itemId) {
  const piece = giveItem(m, ps, itemId);
  const target = [...ps.board.values()].find((p) => p.kind === 'chess');
  assert.ok(target, 'a board piece to equip onto');
  const res = ps.equip(piece.uid, target.uid);
  assert.deepEqual(res, { ok: true }, `${itemId} equips`);
  return target;
}

test('动员令 is the deploy-cap capstone: 10 funds, cap 10, and it only exists for that job', () => {
  const { m } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const rec = gd.item(MOBILIZE);
  assert.ok(rec, 'the item exists');
  assert.equal(rec.name, '动员令');
  assert.equal(rec.endless, true, 'a special item');
  assert.equal(rec.deployCapAtLeast, 10, 'it raises the deploy cap to 10');
  assert.equal(rec.requiresDeployCap, 9, 'and is only offerable at 9');
  assert.equal(gd.itemPrice(MOBILIZE), 10, '售价 10');
  assert.equal(rec.tier, 6, 'shown as the top tier, like 人事部文档');
  assert.equal(Object.keys(rec.mods).length, 0, 'it carries no per-piece stat');
  assert.equal(rec.kind, ENDLESS_ITEM_KIND, 'a consume-on-equip consumable');
  // it is not an ordinary shop item and never appears in the ordinary item slot
  assert.equal(isShopItem(rec), false, 'never drawn by an ordinary item draw');
  assert.equal(rec.shopExcluded, true);
  assert.equal(rec.shopExcludedBy, '无尽模式·无尽商店特殊栏位', 'and the detail popup names its real source');
  m.dispose();
});

test('the offer gate: 动员令 is withheld until the squad really has 9 deploy slots', () => {
  const { m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  const names = (ctx) => gd.endlessShopItemsFor(ctx).map((r) => r.name);

  // 8 slots (the official base): the capstone must not be offerable — it would waste the special slot
  assert.equal(gd.deployCap, 8, 'the official cap is 8');
  assert.equal(ps.deployCap, 8);
  assert.ok(!names(ps).includes('动员令'), 'not offerable at 8');
  assert.equal(names(ps).length, 5, 'the five stat items are');

  // the official 人事部文档 really lifts the cap to 9 …
  give(m, ps, gd.visibleChess[0], 'board', [9, 1]);
  equipOnBoard(m, ps, PERSONNEL_DOC);
  assert.equal(ps.deployCap, 9, '人事部文档 → 9');

  // … and only then does the capstone join the pool
  assert.ok(names(ps).includes('动员令'), 'offerable at 9');
  assert.equal(names(ps).length, 6, 'the full set of six');
  m.dispose();
});

test('equipping 动员令 takes the squad to 10 deploy slots, is destroyed, and stays for the match', () => {
  const { m, ps } = endlessShopMatch({ level: 7 });
  give(m, ps, m.gd.visibleChess[0], 'board', [9, 1]);
  const target = equipOnBoard(m, ps, PERSONNEL_DOC);
  assert.equal(ps.deployCap, 9);

  equipOnBoard(m, ps, MOBILIZE);
  assert.equal(ps.deployCap, 10, 'the cap really moved to 10');
  assert.equal(ps.deployCapMin, 10, 'as a squad-wide floor, not a per-piece stat');
  assert.equal(ps.deployCapBonus, 0, 'and not as a bonus');
  // consumed on equip: gone from the hand and not attached to the piece
  assert.ok(!ps.hand.some((x) => x && x.id === MOBILIZE), 'the consumable was destroyed');
  assert.ok(!(target.items || []).some((i) => i.id === MOBILIZE), 'and never sticks to the wearer');

  // permanent for the match: a fresh round keeps it (endless rounds recompute the player's state)
  ps.startRound(20);
  assert.equal(ps.deployCap, 10, 'still 10 in a later round');
  m.dispose();
});

test('the cap is monotone: a second 动员令 cannot take it past 10 (and the official doc stacks the same way)', () => {
  const { m, ps } = endlessShopMatch({ level: 7 });
  give(m, ps, m.gd.visibleChess[0], 'board', [9, 1]);
  equipOnBoard(m, ps, PERSONNEL_DOC);
  equipOnBoard(m, ps, MOBILIZE);
  assert.equal(ps.deployCap, 10);
  // the official doc again: `setDeployCapAtLeast(9)` only raises a floor, so it never LOWERS 10 back to 9
  equipOnBoard(m, ps, PERSONNEL_DOC);
  assert.equal(ps.deployCap, 10, 'the official doc does not undo the capstone');
  // another capstone: does not reach 11
  equipOnBoard(m, ps, MOBILIZE);
  assert.equal(ps.deployCap, 10, 'a repeat is a no-op, not a stack');
  m.dispose();
});

test('the special slot never wastes a roll on a withheld 动员令, and offers it once eligible', () => {
  const { m, ps } = endlessShopMatch({ level: 7 });
  const gd = m.gd;
  // at 8 slots: 400 rolls must never produce the capstone
  for (let i = 0; i < 400; i++) {
    ps.rollShop();
    for (const s of ps.shop.slots) if (s && s.special) assert.notEqual(s.id, MOBILIZE, `roll ${i} withheld`);
  }
  // at 9 slots it joins the pool and does come up
  give(m, ps, gd.visibleChess[0], 'board', [9, 1]);
  equipOnBoard(m, ps, PERSONNEL_DOC);
  assert.equal(ps.deployCap, 9);
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    ps.rollShop();
    for (const s of ps.shop.slots) if (s && s.special) seen.add(s.id);
  }
  assert.ok(seen.has(MOBILIZE), 'the capstone is drawable at 9');
  assert.equal(seen.size, 6, `all six are drawable (got ${[...seen].join(', ')})`);
  assert.equal(gd.itemPrice(MOBILIZE), 10, 'and it is priced at 10');
  m.dispose();
});

test('every endless special item carries the fields the client needs for its shop card and info popup', () => {
  const { m } = endlessShopMatch({ level: 7 });
  const recs = m.gd.endlessShopItems();
  assert.equal(recs.length, 6, 'six special items now');
  for (const rec of recs) {
    assert.ok(rec.id && rec.name, `${rec.id}: id + name`);
    assert.equal(rec.itemType, 'EQUIP');
    assert.ok(Number.isInteger(rec.tier) && rec.tier >= 1, `${rec.id}: a tier for the chip`);
    assert.ok(Number.isFinite(rec.price) && rec.price > 0, `${rec.id}: a price`);
    assert.ok(rec.desc && rec.descRaw, `${rec.id}: an effect line for the popup`);
    assert.equal(rec.shopExcluded, true, `${rec.id}: not an ordinary draw`);
    assert.equal(rec.shopExcludedBy, '无尽模式·无尽商店特殊栏位', `${rec.id}: names its real source`);
    assert.equal(rec.kind, ENDLESS_ITEM_KIND, `${rec.id}: consume-on-equip`);
    // an icon the client can render: an emoji (no manifest art exists)
    assert.ok(typeof rec.iconEmoji === 'string' && rec.iconEmoji, `${rec.id}: an emoji icon`);
  }
  // and every one of them actually does something when equipped
  for (const rec of recs) {
    assert.ok(Object.keys(rec.mods).length || rec.deployCapAtLeast, `${rec.name}: has an effect`);
  }
  m.dispose();
});

test('data/items.json mirrors the endless items, so the client can draw their shop card and info popup', () => {
  // The client reads item text from data/items.json (public/js/data.js), NOT from the server records, so the specs
  // have to be mirrored there by tools/sync-endless-items.mjs. Without the mirror an endless item renders as a bare id
  // and resolveDetail() returns null — right-clicking the card opens nothing.
  const gd = new GameData(DATA, 'mode_single_abyss');
  gd.setEndlessActive(true);
  const recs = gd.endlessShopItems();
  assert.ok(recs.length, 'the specs exist');
  for (const rec of recs) {
    const mirrored = DATA.items[rec.id];
    assert.ok(mirrored, `${rec.id} is present in data/items.json (run: node tools/sync-endless-items.mjs)`);
    assert.equal(mirrored.name, rec.name, `${rec.id}: mirrored name`);
    assert.equal(mirrored.desc, rec.desc, `${rec.id}: mirrored desc`);
    assert.equal(mirrored.tier, rec.tier, `${rec.id}: mirrored tier`);
    assert.equal(mirrored.price, rec.price, `${rec.id}: mirrored price`);
    assert.equal(mirrored.kind, rec.kind, `${rec.id}: mirrored kind`);
    assert.equal(mirrored.iconEmoji, rec.iconEmoji, `${rec.id}: mirrored icon`);
    assert.equal(mirrored.endless, true, `${rec.id}: marked so the mirror can be replaced on the next sync`);
    assert.equal(mirrored.shopExcludedBy, rec.shopExcludedBy, `${rec.id}: mirrored source line`);
  }
  // the mirror must not have touched any official item
  const official = Object.values(DATA.items).filter((it) => it && !it.endless);
  for (const it of official) assert.ok(!it.endless, `${it.id} is still an official item`);
  assert.ok(!official.some((it) => String(it.id).includes('_endless_')), 'no endless id leaked into the official set');
});


