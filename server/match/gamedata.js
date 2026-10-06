// server/match/gamedata.js — typed, defaulted view of data/*.json for the match engine.
//
// Every lookup is an own-property lookup (ids come from client intents) that never throws and returns null for
// unknown ids. Tunables come from data/config.json with the documented defaults (research 00-INDEX §2–§8) when a
// key is missing, so a partial data set (tests, data being regenerated) still yields a working match.
//
// No custom balance (DESIGN §14 corrections, research 08 §6): enemy numbers are the official ones — the PRTS
// per-round enemyScale table of data/config.json, the leader pool = bloodPoint. data/tuning.json only overrides result
// titles:
//   titles[titleId]                                                { stat?, rule? } merged over config.titles
// (the former enemyHpMul / enemyAtkMul / enemySpeedMul / bossHpMul / flyPlaceholders knobs were removed; a tuning file
// that still carries them is ignored).

import { getConfig, getMode } from '../data.js';
import { isShopItem } from '../sim/simdata.js';

const own = (map, id) => (map && typeof map === 'object' && typeof id === 'string' && Object.hasOwn(map, id) && map[id] && typeof map[id] === 'object' ? map[id] : null);
const numOr = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const posIntOr = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);

export const DEFAULTS = Object.freeze({
  income: [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 12, 12, 12, 12],
  incomeCap: 12,
  chessPrice: { 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 },
  sellPrice: 1,
  refreshPrice: 1,
  poolCopies: { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 },
  mergeCount: 3,
  goldenCopies: 3,
  itemMergeCount: 2,
  benchSize: 10,
  tempSize: 5,
  deployCap: 8,
  equipPerChess: 2,
  maxArtsPerRound: 2,
  rewardOffer: { count: 3, tierOffset: 1, maxTier: 6, price: 0 },
  upgradePrices: [5, 8, 11, 12, 13],
  maxShopLevel: 6,
  shopSlots: { 1: { chess: 3, item: 1 }, 2: { chess: 4, item: 1 }, 3: { chess: 4, item: 1 }, 4: { chess: 5, item: 1 }, 5: { chess: 5, item: 1 }, 6: { chess: 5, item: 1 } },
  defaultBandId: 'band_bldsk',
  defaultStartLp: 28,
  lpCapPerRound: 10,
  bossOvertimeAfter: 150,
  bossOvertimeDrainPerSec: 1,
  hiddenCore: { single: 350, multi: 1200, minTeamLpExclusive: 1, difficulties: ['NORMAL', 'HARD', 'ABYSS'] },
  // Endless mode (无尽模式): offered after a cleared Hidden Core. Rounds continue past `lastRound`; every cycle is
  // `eliteRounds` elite rounds + 1 boss round, and each endless round multiplies the ROUND-15 stats again:
  //   hp  ×= growth.hp^step,  atk ×= growth.atk^step,  def ×= growth.def^step      (step = rounds past the core)
  // Boss rounds draw from the Final Assault and Hidden Core pools together, with the same hp growth applied to the
  // shared leader hp pool. All of it is overridable from config.json `endless` / `modes[*].endless`.
  endless: {
    eliteRounds: 6,
    // The endless loop's 6 elite waves mirror the official run's 6 elite rounds IN ORDER: wave 1 = round 8's template
    // (h01), wave 2 = round 9's (h02), … wave 6 = round 13's (h06), then the cycle repeats. So cycle N's wave K always
    // fields the same composition as cycle 1's wave K; the difficulty difference comes from the compounding
    // multipliers (gamedata.roundScale), not from swapping templates.
    eliteTemplateRounds: [8, 9, 10, 11, 12, 13],
    // An explicit template list instead of `eliteTemplateRounds` (null = derive from those rounds). Kept as an escape
    // hatch for the 数值修改器 / a config override; must hold `eliteRounds` usable templates to take effect.
    eliteTemplates: null,
    growth: { hp: 1.05, atk: 1.03, def: 1.03 },
    // Per-wave balance on the player's side, applied when a wave ENDS (settle) from `fromWave` on:
    //   every ALIVE player loses `layerCut` layers from its HIGHEST-layer bond (ties broken at random among the equal
    //   maxima; skipped when that bond holds fewer than `layerCut`), and gains `lpGain` target LP (`maxLp` caps it).
    //   Active-ness is NOT required: the highest stack is what the trade bites, inactive layers included.
    // `fromWave` counts ENDLESS waves: 1 = the first endless wave (round 16 — the Hidden Core at 15 is not part of
    // the loop). 2 = "from the end of wave 16" — wave 16 is endless wave 1, so it still passes without the cut and
    // the trade starts with wave 17.
    balance: { fromWave: 2, layerCut: 15, lpGain: 1, maxLp: null },
    // ---- 机变阶段 in the loop ----------------------------------------------------------------------
    // The official run holds its 机变阶段 (SP_DRAFT: 悬赏决策 选敌人 / 道具补给 选道具 / 机密商店 / 战术决策 —
    // "选道具或敌人") at rounds 3 / 9 / 11 only. The endless cycle keeps the beat ONCE PER CYCLE: the wave right
    // after the THIRD wave of each 7-wave cycle (6 elite + 1 boss) opens with one — cycle 1: R18 ends → R19 drafts;
    // cycle 2: R25 ends → R26; cycle 3: R32 ends → R33 … `afterWave` is 1-based (3 = the cycle's third wave).
    draft: {
      afterWave: 3,
      families: [['bounty', 14], ['shop', 4], ['tactic', 4]],
      cards: null,               // null = the format's own count (solo 3 / multi 6)
      supplyTiers: [4, 6],
    },
    // ---- endless shop (商店 7 级 + 特殊道具栏) ------------------------------------------------------
    // While the loop is live the shop may reach `maxLevel`; the operator / normal-item odds stay EXACTLY those of
    // level 6 (pool.tierShares caps its tiers at the data's tier count, so a higher level adds no new tiers), and the
    // level opens one extra slot that only ever offers `items`.
    shop: {
      maxLevel: 7,
      // The 无尽模式-only step 6 → 7. Deliberately NOT the official ladder's last value (13): this level is the loop's
      // own capstone, so it opens at a steep 20 and then rides the SAME per-round discount every other level does
      // (PlayerState.startRound: `upgradePrice - 1` every round from R2 on), i.e. it gets cheaper as the loop runs.
      priceToMaxLevel: 20,
      specialSlots: 1,
      items: [
        {
          // The icons are EMOJI, not asset ids: the game ships no art for these items, and reusing another item's
          // trap icon makes two different cards look identical. iconEmoji renders as a standalone <img> data URL
          // (client assetUrls.itemIconUrl), so every icon slot in the UI works unchanged. Each emoji matches its stat.
          //
          // The NAMES follow the official item naming (`data/items.json`): a short noun phrase with no prefix and no
          // numbering, e.g. 坚守盾牌 / 源石溶剂 / 紧急调度券. 无尽核心 is the anchor of the set (it is the item that
          // drives the endless shop); the other four name the stat they carry.
          id: 'chess_item_endless_01_e_a', name: '无尽核心', iconEmoji: '❤️',
          desc: '装备时销毁，携带者生命值+3%', params: { max_hp: 0.03 },
        },
        {
          id: 'chess_item_endless_02_e_a', name: '超频芯片', iconEmoji: '⚡',
          desc: '装备时销毁，携带者攻击速度+15', params: { attack_speed: 15 },
        },
        {
          id: 'chess_item_endless_03_e_a', name: '壁垒发生器', iconEmoji: '🛡️',
          desc: '装备时销毁，携带者防御力+3%', params: { def: 0.03 },
        },
        {
          id: 'chess_item_endless_04_e_a', name: '奥术棱镜', iconEmoji: '✨',
          desc: '装备时销毁，携带者法术抗性+1', params: { magic_resistance: 1 },
        },
        {
          // NOTE: the spec listed "生命值+3%" and "血量+3%" as separate effects, but both are max_hp in this game.
          // The fifth is therefore attack +3% so the five cover five distinct stats.
          id: 'chess_item_endless_05_e_a', name: '猎手瞄准镜', iconEmoji: '⚔️',
          desc: '装备时销毁，携带者攻击力+3%', params: { atk: 0.03 },
        },
        {
          // The set's capstone: it is NOT offered until the squad has 9 deploy slots — i.e. until the player has
          // consumed the official 人事部文档 (chess_item_6_08_e_a, "最大可部署人数变为9") on the first target. It then
          // raises the cap one more step (9 → 10) for the rest of the match, at a steep 10 funds.
          id: 'chess_item_endless_06_e_a', name: '动员令', iconEmoji: '📜',
          desc: '装备时销毁，最大可部署人数变为10',
          deployCapAtLeast: 10,
          requiresDeployCap: 9,
          price: 10,
        },
      ],
    },
  },
  dp: { init: 10, perSec: 1, max: 99 },
  unite: { maxHelpers: 2, templates: { 1: 'act1autochess_escaped_single', 2: 'act1autochess_escaped_multi' } },
  timers: { infoCheck: 25, bandDraft: 50, bandTurn: 30, battleCheck: 3, spFirst: 30, spTurn: 16 },
  bans: { FUNNY: { core: 0, addon: 1 }, NORMAL: { core: 3, addon: 4 }, HARD: { core: 3, addon: 4 }, ABYSS: { core: 3, addon: 4 } },
  bandDraft: { skipsPerPlayer: 1, timeoutBandId: 'band_bldsk' },
  leftoverFundsKeptByBands: ['band_cannot'],
});

/** Game seconds per real second of a battle (forced 2×): combat limits in data are real seconds (combatTimeLimit). */
export const COMBAT_TIME_SCALE = 2;

/**
 * Enemy multipliers for a round: the official table, extended past the last round by the endless compounding
 * (无尽模式, docs/ENDLESS.md). Kept module-level so the maths is testable on its own.
 *
 *   r ≤ lastRound : the official row as-is
 *   r  > lastRound: row(lastRound) × growth^(r − lastRound) per stat, plus defMul (growth.def), which the
 *                   official table has no column for.
 *
 * @param {number} r
 * @param {{ baseEnemyScale: (r: number) => object, lastRound: number, endlessCfg: { growth: { hp: number, atk: number, def: number } } }} gd
 */
export function roundScale(r, gd) {
  const last = gd.lastRound;
  const official = gd.baseEnemyScale(Math.min(r, last));
  if (!gd.isEndlessRound(r)) return official;
  // the compounding counts ENDLESS waves: the first endless wave is step 1
  const st = gd.endlessStep(r);
  const g = gd.endlessCfg.growth;
  return {
    hpMul: Math.fround(official.hpMul * Math.pow(g.hp, st)),
    atkMul: Math.fround(official.atkMul * Math.pow(g.atk, st)),
    defMul: Math.fround(Math.pow(g.def, st)),
    speedMul: official.speedMul,
    endless: st,
  };
}

/** Strip the _a/_b suffix of an item id (the registry key of an item family). */
export const itemKey = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');

/**
 * 无尽模式's special items are consumable equipment: `kind` starts with 'consume_on_equip' so PlayerState.equip
 * destroys them on use (and routes through the registered onEquip handler), and the battle side reads their params as
 * a permanent stat bonus through the piece (PlayerState.pieceStats).
 */
export const ENDLESS_ITEM_KIND = 'consume_on_equip';
/** Buff key the endless items carry: simdata.buffsOf exposes it as `bbKey`, items/battle.js STAT_BUFFS reads it. */
export const ENDLESS_STAT_BUFF_KEY = 'attr_common_global_buff';
/** Registry key of the endless consumable's equip handler (server/match/builtinMeta.js). */
export const ENDLESS_EQUIP_KEY = 'endless_stat_bonus';
/** Persisted per-piece stat bonus keys (the mods items/battle.js statMods produces). */
export const ENDLESS_STAT_KEYS = Object.freeze(['hpPct', 'aspd', 'defPct', 'resFlat', 'atkPct']);

/** Map an endless item spec's params (the official bb names) onto mods keys. */
function endlessStatMods(spec) {
  const p = spec && spec.params && typeof spec.params === 'object' ? spec.params : {};
  const out = {};
  if (Number.isFinite(p.max_hp) && p.max_hp) out.hpPct = p.max_hp;
  if (Number.isFinite(p.attack_speed) && p.attack_speed) out.aspd = p.attack_speed;
  if (Number.isFinite(p.def) && p.def) out.defPct = p.def;
  if (Number.isFinite(p.magic_resistance) && p.magic_resistance) out.resFlat = p.magic_resistance;
  if (Number.isFinite(p.atk) && p.atk) out.atkPct = p.atk;
  return out;
}

/**
 * Register the equip handler of every 无尽模式 special item under the key PlayerState.equip looks up
 * (`item:${itemKey(id)}`), so equipping one is allowed and routes through builtinMeta's `endless_stat_bonus`.
 * Content registerMeta runs before this and never names these keys, so registering here cannot be overridden.
 *
 * ONE handler serves both shapes a spec can have:
 *   * `params`          — a flat stat the piece carries for the rest of the match (`addPieceStat`, the 5 stat items)
 *   * `deployCapAtLeast` — a squad-wide deploy-slot floor (the 动员令 capstone, mirroring the official
 *                          人事部文档's `equip_destory_deployment_cnt_change`)
 * A spec with neither is a data error and is refused instead of silently doing nothing.
 */
function registerEndlessItems(register, gd) {
  const handler = {
    onEquip(ctx, ev) {
      const rec = ev && ev.item ? gd.item(ev.item.id) : null;
      if (!rec) { ev.error = 'BAD_TARGET'; ev.detail = 'unknown endless item'; return; }
      let did = false;
      const mods = rec.mods;
      if (mods && Object.keys(mods).length) { ctx.addPieceStat(ev.target.uid, mods); did = true; }
      const cap = rec.deployCapAtLeast;
      if (Number.isInteger(cap) && cap > 0) { ctx.setDeployCapAtLeast(cap); did = true; }
      if (!did) { ev.error = 'BAD_TARGET'; ev.detail = 'endless item without an effect'; }
    },
  };
  for (const id of Object.keys(gd._endlessItemMap)) {
    register(`item:${itemKey(id)}`, handler);
    register(`item:${id}`, handler);
  }
}

/**
 * Build a complete item record for an endless shop item (`endless.shop.items[]`). The shape mirrors data/items.json
 * so every consumer (gd.item, itemPrice, the shop views, combat.setEquip, the battle item walk) works unchanged:
 * EQUIP + tier + price, a `buffs` entry that names the global stat buff, and `shopExcluded` so no ordinary draw sees it.
 */
export function endlessItemRecord(spec) {
  if (!spec || typeof spec.id !== 'string' || !spec.id) return null;
  const params = { ...(spec.params || {}), key: ENDLESS_STAT_BUFF_KEY };
  const emoji = typeof spec.iconEmoji === 'string' && spec.iconEmoji ? spec.iconEmoji : null;
  return {
    id: spec.id,
    baseId: spec.id,
    goldenId: spec.id,
    isGolden: false,
    // the emoji is the icon: `icon` carries it through the existing asset manifest path (data/assets.json lookup is
    // skipped for these ids, so the client reads `icon`/`iconEmoji` and builds a standalone data URL)
    icon: emoji || spec.iconId || spec.id,
    iconEmoji: emoji,
    iconId: spec.iconId || spec.id,
    identifier: 900 + (Number(spec.identifier) || 0),
    name: String(spec.name || spec.id),
    itemType: 'EQUIP',
    // VI — the top tier, matching the official items these are meant to sit beside (人事部文档, the capstone's
    // prerequisite, is chess_item_6_08_e_a, tier 6). Only a display value: the endless slot is not a tier draw.
    tier: Number.isInteger(spec.tier) ? spec.tier : 6,
    price: Number.isFinite(spec.price) ? spec.price : 3,
    hideInShop: false,
    shopExcluded: true,          // never in an ordinary item draw
    shopExcludedBy: '无尽模式·无尽商店特殊栏位',
    endless: true,               // marks the record for the endless shop slot and the tooling
    mergeable: false,
    upgradeNum: 0,
    upgradeChessId: null,
    giveBondId: null,
    givePowerId: null,
    canGiveBond: false,
    requiresBondId: null,
    duration: -1,
    kind: ENDLESS_ITEM_KIND,
    effectId: spec.id,
    effectName: String(spec.name || spec.id),
    desc: String(spec.desc || ''),
    descRaw: String(spec.desc || ''),
    params,
    buffs: [{ key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: { ...(spec.params || {}) }, bbStr: { key: ENDLESS_STAT_BUFF_KEY } }],
    mods: endlessStatMods(spec),
    // squad-wide effects (currently the deploy-slot floor of the 动员令 capstone). null when the spec has none, so a
    // consumer can always test `rec.deployCapAtLeast`.
    deployCapAtLeast: Number.isInteger(spec.deployCapAtLeast) && spec.deployCapAtLeast > 0 ? spec.deployCapAtLeast : null,
    // offer gate: the spec is only drawn once the player's deploy slots reached this floor (and, if it names ids, once
    // every one of those items has been used — see GameData.endlessItemOfferable).
    requiresDeployCap: Number.isInteger(spec.requiresDeployCap) && spec.requiresDeployCap > 0 ? spec.requiresDeployCap : null,
    requiresItemsUsed: Array.isArray(spec.requiresItemsUsed) && spec.requiresItemsUsed.length
      ? spec.requiresItemsUsed.filter((x) => typeof x === 'string' && x) : null,
  };
}

export class GameData {
  /**
   * @param {Readonly<Record<string, any>>} data server/data.js getData() (may be partial)
   * @param {string} modeId e.g. 'mode_multi_hard'
   */
  constructor(data, modeId) {
    this.raw = data && typeof data === 'object' ? data : {};
    this.config = getConfig(this.raw) || {};
    this.modeId = modeId;
    this.mode = getMode(modeId, this.raw) || {};
    this.economy = this.config.economy && typeof this.config.economy === 'object' ? this.config.economy : {};
    const chess = this.raw.chess && typeof this.raw.chess === 'object' ? this.raw.chess : {};
    this._chess = chess;
    this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
    this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
    /**
     * 无尽模式's special items (endless.shop.items), built from the config into complete item records. They live here
     * rather than in data/items.json so a data update cannot drop them, and `shopExcluded: true` keeps them out of
     * every ordinary item draw (simdata.isShopItem) — only the endless shop's special slot offers them.
     */
    this._endlessItemMap = {};
    for (const spec of (this.endlessCfg.shop.items || [])) {
      const rec = endlessItemRecord(spec);
      if (rec) this._endlessItemMap[rec.id] = rec;
    }
    /** visible, shop-eligible base (normal) chess ids */
    this.visibleChess = Object.keys(chess).filter((id) => {
      const c = chess[id];
      return c && c.visible && !c.isGolden && !c.isDiy && !c.isHidden && Number.isInteger(c.tier);
    }).sort();
    /**
     * Shop item ids by tier (sim/simdata.js isShopItem: normal EQUIP, not hidden, not effect-only — the special
     * 维式重锤 and 突变细胞 are never sold). Every "shop item" draw uses it: the shop item slot (pool.js), the 道具补给 /
     * 机密商店 cards (choices.js) and the shop-eligible item pools (Match.rollItemId).
     */
    this.shopItemsByTier = {};
    for (const [id, it] of Object.entries(this._items)) {
      if (!isShopItem(it)) continue;
      (this.shopItemsByTier[it.tier] ||= []).push(id);
    }
    for (const k of Object.keys(this.shopItemsByTier)) this.shopItemsByTier[k].sort();
    this.bondIds = Object.keys(this._bonds).sort((a, b) => (numOr(this._bonds[a].identifier, 99) - numOr(this._bonds[b].identifier, 99)) || (a < b ? -1 : 1));
    this.modeInactiveBonds = new Set(Array.isArray(this.mode.inactiveBondIds) ? this.mode.inactiveBondIds : []);
    /** bandBondIds memo */
    this._bandBonds = new Map();
    this.inactiveEnemies = new Set(Array.isArray(this.mode.inactiveEnemyKeys) ? this.mode.inactiveEnemyKeys : []);
    /** data/tuning.json (titles only, see the header) */
    this.tuning = this.raw.tuning && typeof this.raw.tuning === 'object' ? this.raw.tuning : {};
  }

  /**
   * Leader HP pool multiplier — always 1 (no custom balance). Kept for callers written against the old tuning layer
   * (finalAssault.bossPoolHp); use `bossPoolHp` / `bossPoolShare` for the official pool.
   * @deprecated
   */
  bossHpMul(bossId) { // eslint-disable-line no-unused-vars
    return 1;
  }

  /**
   * Official shared leader HP pool (DESIGN §20.10): ONE pool for every boss field of the match (official tip "最终攻势中，
   * 所有人将一起对敌方领袖造成伤害"; the mirrored copies of a pair field share it — notice 5114 "两侧的敌方领袖共享生命值
   * （敌方领袖的总生命值不变）", which is about those copies, not about the number of players). Co-op = bloodPoint
   * [difficulty]; with config bossHpScale.aliveScaling (default false) × alive / aliveFull (4) — 巴哈姆特 12294 "聯機隊友
   * (撤退/死掉)變少，最後boss血條也會變少" is one community note without a proportion, kept off until confirmed (it would
   * shorten fights after eliminations, the opposite of the playtest report); `aliveCount` omitted ⇒ a full team. Solo = bloodPoint ×
   * bossHpScale.solo (0.25 = one player of four, [ASSUMED]). Leaders are never scaled by enemyScale ("领袖单位于服务器的
   * 生命值加成不受上述加成影响").
   * @param {string} bossId
   * @param {number} [aliveCount] alive players at the Final Assault / Hidden Core start (co-op)
   * @returns {number}
   */
  bossPoolHp(bossId, aliveCount) {
    const boss = this.boss(bossId);
    const diff = this.difficulty;
    let base = boss && boss.bloodPoint && Number.isFinite(boss.bloodPoint[diff]) ? boss.bloodPoint[diff] : null;
    if (base == null && boss && boss.bloodPoint) base = Object.values(boss.bloodPoint).find((v) => Number.isFinite(v)) ?? null;
    if (base == null) base = 500000;
    return Math.max(1, Math.round(base * this.bossPoolShare(aliveCount)));
  }

  /**
   * Multiplier of bloodPoint for the leader pool (see bossPoolHp): solo = bossHpScale.solo (0.25); co-op = coop (1) ×
   * min(alive, aliveFull) / aliveFull when bossHpScale.aliveScaling (mode entry first, then the global one).
   * @param {number} [aliveCount]
   */
  bossPoolShare(aliveCount) {
    const ms = this.mode.bossHpScale && typeof this.mode.bossHpScale === 'object' ? this.mode.bossHpScale : {};
    const cs = this.config.bossHpScale && typeof this.config.bossHpScale === 'object' ? this.config.bossHpScale : {};
    const pick = (k, d) => (Number.isFinite(ms[k]) && ms[k] > 0 ? ms[k] : Number.isFinite(cs[k]) && cs[k] > 0 ? cs[k] : d);
    if (this.isSolo) return pick('solo', 0.25);
    const scaling = typeof ms.aliveScaling === 'boolean' ? ms.aliveScaling : cs.aliveScaling === true;
    const full = Math.max(1, Math.floor(pick('aliveFull', 4)));
    const n = Number(aliveCount);
    const alive = scaling && Number.isFinite(n) && n >= 1 ? Math.min(full, Math.floor(n)) : full;
    return pick('coop', 1) * (alive / full);
  }

  /** config.titles with the tuning overrides (stat / rule per title id) merged in. */
  get titles() {
    const list = Array.isArray(this.config.titles) ? this.config.titles : [];
    const ov = this.tuning.titles && typeof this.tuning.titles === 'object' ? this.tuning.titles : {};
    return list.map((t) => {
      if (!t || typeof t.id !== 'string' || !Object.hasOwn(ov, t.id) || !ov[t.id] || typeof ov[t.id] !== 'object') return t;
      const o = ov[t.id];
      const out = { ...t };
      if (typeof o.stat === 'string') out.stat = o.stat;
      if (o.rule === 'max' || o.rule === 'min') out.rule = o.rule;
      return out;
    });
  }

  // ---- ids ------------------------------------------------------------------------------------------

  chess(id) { return own(this._chess, id); }
  item(id) { return own(this._endlessItemMap, id) || own(this._items, id); }
  bond(id) { return own(this._bonds, id); }
  band(id) { return own(this.raw.bands, id); }
  garrison(id) { return own(this.raw.garrisons, id); }
  effect(id) { return own(this.raw.effects, id); }
  enemy(key) { return own(this.raw.enemies, key); }
  wave(id) { return own(this.raw.waves, id); }
  stage(id) { return own(this.raw.stages, id); }
  boss(id) { return own(this.raw.bosses, id); }
  token(id) { return own(this.raw.tokens, id); }
  get choices() { return this.raw.choices && typeof this.raw.choices === 'object' ? this.raw.choices : {}; }
  get factions() { return this.raw.factions && typeof this.raw.factions === 'object' ? this.raw.factions : {}; }

  /** Normal (base) chess id of a chess id (golden → base). */
  baseIdOf(id) {
    const c = this.chess(id);
    if (!c) return typeof id === 'string' ? id.replace(/_b$/, '_a') : null;
    return c.baseId || (c.isGolden ? id.replace(/_b$/, '_a') : id);
  }

  goldenIdOf(id) {
    const c = this.chess(this.baseIdOf(id));
    if (c && c.goldenId && this.chess(c.goldenId)) return c.goldenId;
    const alt = typeof id === 'string' ? id.replace(/_a$/, '_b') : null;
    return alt && this.chess(alt) ? alt : null;
  }

  isGolden(id) { const c = this.chess(id) || this.item(id); return !!(c && c.isGolden); }

  tierOf(id) {
    const c = this.chess(id) || this.item(id);
    return c && Number.isInteger(c.tier) ? c.tier : 1;
  }

  // ---- economy --------------------------------------------------------------------------------------

  income(round) {
    const arr = Array.isArray(this.economy.income) ? this.economy.income : DEFAULTS.income;
    const cap = numOr(this.economy.incomeCap, DEFAULTS.incomeCap);
    const v = arr[round];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    return Math.max(0, Math.min(cap, 3 + round));
  }

  chessPrice(id) {
    const c = this.chess(id);
    if (c && Number.isFinite(c.price) && c.price >= 0) return c.price;
    const tier = this.tierOf(id);
    const row = this.economy.chessPrice && this.economy.chessPrice[tier];
    const golden = c && c.isGolden;
    if (row && typeof row === 'object') return numOr(golden ? row.golden : row.normal, DEFAULTS.chessPrice[tier] ?? 3);
    return DEFAULTS.chessPrice[tier] ?? 3;
  }

  sellPrice(id) {
    const c = this.chess(id);
    if (c && Number.isFinite(c.sellPrice) && c.sellPrice >= 0) return c.sellPrice;
    const tier = this.tierOf(id);
    const row = this.economy.chessSell && this.economy.chessSell[tier];
    if (row && typeof row === 'object') return numOr(c && c.isGolden ? row.golden : row.normal, DEFAULTS.sellPrice);
    return DEFAULTS.sellPrice;
  }

  itemPrice(id) {
    const it = this.item(id);
    return it && Number.isFinite(it.price) && it.price >= 0 ? it.price : 2;
  }

  get refreshPrice() { return Math.max(0, numOr(this.economy.refreshPrice, DEFAULTS.refreshPrice)); }
  get benchSize() { return posIntOr(this.economy.benchSize, DEFAULTS.benchSize); }
  get tempSize() { return posIntOr(this.economy.tempSize, DEFAULTS.tempSize); }
  get deployCap() { return posIntOr(this.economy.deployCap, DEFAULTS.deployCap); }
  get equipPerChess() { return posIntOr(this.economy.equipPerChess, DEFAULTS.equipPerChess); }
  get maxArtsPerRound() { return posIntOr(this.economy.maxArtsPerRound, DEFAULTS.maxArtsPerRound); }
  get goldenCopies() { return posIntOr(this.economy.goldenCopies, DEFAULTS.goldenCopies); }
  get itemMergeCount() { return posIntOr(this.economy.itemMergeCount, DEFAULTS.itemMergeCount); }
  get leftoverKeptBands() { return Array.isArray(this.economy.leftoverFundsKeptByBands) ? this.economy.leftoverFundsKeptByBands : DEFAULTS.leftoverFundsKeptByBands; }
  get defaultBandId() { return typeof this.economy.defaultBandId === 'string' ? this.economy.defaultBandId : DEFAULTS.defaultBandId; }
  get defaultStartLp() { return posIntOr(this.economy.defaultStartLp, DEFAULTS.defaultStartLp); }

  rewardOffer() {
    const r = this.economy.rewardOffer && typeof this.economy.rewardOffer === 'object' ? this.economy.rewardOffer : {};
    return {
      count: posIntOr(r.count, DEFAULTS.rewardOffer.count),
      tierOffset: Number.isInteger(r.tierOffset) ? r.tierOffset : DEFAULTS.rewardOffer.tierOffset,
      maxTier: posIntOr(r.maxTier, DEFAULTS.rewardOffer.maxTier),
      price: Math.max(0, numOr(r.price, 0)),
    };
  }

  /** Copies of a base chess in the shared pool. */
  poolCopies(baseId) {
    const ov = this.economy.poolCopiesOverrides;
    if (ov && typeof ov === 'object' && Number.isInteger(ov[baseId]) && ov[baseId] >= 0) return ov[baseId];
    const tier = this.tierOf(baseId);
    const pc = this.economy.poolCopies;
    const v = pc && typeof pc === 'object' ? pc[tier] : undefined;
    return Number.isInteger(v) && v >= 0 ? v : (DEFAULTS.poolCopies[tier] ?? 10);
  }

  /** Copies needed to merge (0 = never merges: golden chess). */
  mergeCount(id) {
    const c = this.chess(id);
    if (!c || c.isGolden) return 0;
    if (Number.isInteger(c.upgradeNum) && c.upgradeNum > 0) return c.upgradeNum;
    const ov = this.economy.mergeCountOverrides;
    if (ov && Number.isInteger(ov[id])) return ov[id];
    return posIntOr(this.economy.mergeCount, DEFAULTS.mergeCount);
  }

  // ---- mode -----------------------------------------------------------------------------------------

  get isSolo() { return this.mode.type === 'SINGLE' || /^mode_single_/.test(this.modeId || ''); }
  get difficulty() { return this.mode.difficulty || (this.modeId ? String(this.modeId).split('_').pop().toUpperCase() : 'NORMAL'); }
  get lastRound() {
    if (Number.isInteger(this.mode.lastRound) && this.mode.lastRound > 0) return this.mode.lastRound;
    return this.modeId === 'mode_single_funny' ? 9 : 14;
  }
  get bossRound() { return Number.isInteger(this.mode.bossRound) && this.mode.bossRound > 0 ? this.mode.bossRound : this.lastRound; }
  get hiddenRound() { return Number.isInteger(this.mode.hiddenRound) && this.mode.hiddenRound > 0 ? this.mode.hiddenRound : null; }
  /**
   * Highest shop level. 无尽模式 opens one more level (endless.shop.maxLevel, 7) once the loop is live — its odds are
   * exactly level 6's (no new chess/item tiers), it only adds the special-item slot (PlayerState.rollShop).
   */
  get maxShopLevel() {
    const base = posIntOr(this.mode.maxShopLevel, DEFAULTS.maxShopLevel);
    if (!this.endlessActive || !this.isEndlessAvailable()) return base;
    return Math.max(base, this.endlessCfg.shop.maxLevel);
  }

  /** Is the endless shop open? (the loop is live, so level 7 and its special slot exist) */
  get endlessShopOpen() {
    return this.endlessActive && this.isEndlessAvailable();
  }

  /** The endless special items (complete records), in config order. Empty outside the endless loop. */
  endlessShopItems() {
    if (!this.endlessShopOpen) return [];
    return Object.keys(this._endlessItemMap).map((id) => this._endlessItemMap[id]);
  }

  /** Is `id` one of the endless special items? */
  isEndlessShopItem(id) {
    return typeof id === 'string' && Object.hasOwn(this._endlessItemMap, id);
  }

  /**
   * Are a spec's offer requirements met? The special slot of a shop roll must never offer an item the player cannot
   * use yet — the 动员令 capstone is only drawn once the squad really has 9 deploy slots (i.e. after the official
   * 人事部文档 was consumed), so it never wastes the slot that could carry a stat item.
   *
   * `ctx` is anything carrying the player's state:
   *   * `deployCap`          — the effective cap (PlayerState.deployCap) for `requiresDeployCap`
   *   * `usedEndlessItems`   — a Set/array of special-item ids the player has already consumed, for `requiresItemsUsed`
   * A record without either requirement is always offerable.
   */
  endlessItemOfferable(rec, ctx = {}) {
    if (!rec) return false;
    if (Number.isInteger(rec.requiresDeployCap)) {
      const cap = numOr(ctx.deployCap, 0);
      if (cap < rec.requiresDeployCap) return false;
    }
    if (Array.isArray(rec.requiresItemsUsed) && rec.requiresItemsUsed.length) {
      const used = ctx.usedEndlessItems;
      const has = (id) => (used instanceof Set ? used.has(id) : Array.isArray(used) ? used.includes(id) : false);
      for (const id of rec.requiresItemsUsed) if (!has(id)) return false;
    }
    return true;
  }

  /** The special items `ctx` may be offered right now (gated by endlessItemOfferable), in config order. */
  endlessShopItemsFor(ctx = {}) {
    return this.endlessShopItems().filter((rec) => this.endlessItemOfferable(rec, ctx));
  }

  /** How many special slots the shop shows at `level` (endless shop only, at its top level). */
  endlessSpecialSlots(level) {
    if (!this.endlessShopOpen) return 0;
    if (!(Number.isInteger(level) && level >= this.endlessCfg.shop.maxLevel)) return 0;
    return this.endlessCfg.shop.specialSlots;
  }

  roundCfg(r) {
    const rounds = this.mode.rounds;
    return rounds && typeof rounds === 'object' && rounds[String(r)] && typeof rounds[String(r)] === 'object' ? rounds[String(r)] : null;
  }

  spRounds() { return Array.isArray(this.mode.spRounds) ? this.mode.spRounds.filter((n) => Number.isInteger(n)) : []; }

  /**
   * The official upgrade ladder (index i = the price of level i+1 → i+2). It has ONE ENTRY LESS than the top level:
   * the data lists the five steps 5/8/11/12/13 for levels 1…6, so `length === maxShopLevel - 1` is normal and must
   * never be padded here.
   */
  upgradePrices() {
    const arr = Array.isArray(this.mode.upgradePrices) ? this.mode.upgradePrices : DEFAULTS.upgradePrices;
    return arr.map((v) => Math.max(0, numOr(v, 99)));
  }

  /** Base price to go from `level` to level+1 (null at max). The endless level's step comes from its own config. */
  upgradeBase(level) {
    if (level >= this.maxShopLevel) return null;
    const arr = this.upgradePrices();
    if (level - 1 < arr.length) return arr[level - 1];
    // past the official ladder (无尽模式's extra level)
    return Math.max(0, numOr(this.endlessCfg.shop.priceToMaxLevel, 13));
  }

  shopSlots(level) {
    const s = this.mode.shopSlots && this.mode.shopSlots[String(level)];
    const d = DEFAULTS.shopSlots[level] || DEFAULTS.shopSlots[6];
    if (!s || typeof s !== 'object') return { ...d };
    const chess = Number.isInteger(s.chess) && s.chess >= 0 ? s.chess : d.chess;
    const item = Number.isInteger(s.item) && s.item >= 0 ? s.item : d.item;
    return { chess: Math.min(chess, 8), item: Math.min(item, 4) };
  }

  /** Real-second prep timer for round r (null = untimed). */
  prepTime(r) {
    const rc = this.roundCfg(r);
    if (!rc) return this.isSolo ? null : 90;
    const v = rc.prepTime;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** The round level's `maxPlayTime` (config rounds[r].combatTimeLimit) as data gives it — REAL seconds. */
  combatTimeLimitReal(r) {
    const rc = this.roundCfg(r) || (this.isEndlessRound(r) ? this.roundCfg(this.lastRound) : null);
    const v = rc ? rc.combatTimeLimit : undefined;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    const m = this.mode.combatTimeLimit && this.mode.combatTimeLimit[String(r)];
    return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 60;
  }

  /**
   * Combat time limit of round r in GAME seconds (what the Battle and 联防 use): maxPlayTime × the forced battle speed
   * (config.combatTimeScale, default COMBAT_TIME_SCALE 2). `maxPlayTime` counts real seconds of the 2× battle: read
   * as game seconds, the rounds' own spawn schedules would not fit (R2 spawns its last flyer at 43 s of a 45 s limit,
   * R3 at 62 s of 55 s — enemies that can never be killed, or never spawn), while × 2 every limit is ≈ the last spawn +
   * one flyer crossing (R2 43 + 44 ≈ 90, R3 62 + 44 ≈ 110, R5 38 + 67 ≈ 110). docs/BALANCE.md §2.1.
   */
  combatTimeLimit(r) {
    return this.combatTimeLimitReal(r) * this.combatTimeScale;
  }

  /** Game seconds per real second of a battle (config.combatTimeScale, default COMBAT_TIME_SCALE 2). */
  get combatTimeScale() {
    const k = numOr(this.config.combatTimeScale, COMBAT_TIME_SCALE);
    return k > 0 ? k : COMBAT_TIME_SCALE;
  }

  /**
   * The boss round level's `maxPlayTime` (config rounds[r].levelMaxPlayTime, 120) in REAL seconds — the countdown of
   * the Final Assault / Hidden Core. It is not a hard stop there ("计时结束后战斗仍然会继续", research 01 §10); null
   * when the data has none.
   */
  bossLevelTime(r) {
    const rc = this.roundCfg(r) || (this.isEndlessBossRound(r)
      ? (this.roundCfg(this.hiddenRound) || this.roundCfg(this.bossRound)) : null);
    const v = rc ? rc.levelMaxPlayTime : undefined;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  }

  /** Real-second overtime start of round r (boss rounds): falls back to the last boss round for endless ones. */
  bossOvertimeAfterRealFor(r) {
    const rc = this.roundCfg(r) || (this.isEndlessBossRound(r)
      ? (this.roundCfg(this.hiddenRound) || this.roundCfg(this.bossRound)) : null);
    const v = rc ? rc.bossOvertimeAfter : undefined;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : this.bossOvertimeAfterReal;
  }

  /** Official enemy multipliers of round r (config enemyScale: the PRTS table + 终极 speed ×1.15 from R3). */
  baseEnemyScale(r) {
    const e = this.mode.enemyScale && this.mode.enemyScale[String(r)];
    if (!e || typeof e !== 'object') return { hpMul: 1, atkMul: 1, speedMul: 1 };
    return {
      hpMul: Math.max(0.01, numOr(e.hp, 1)),
      atkMul: Math.max(0, numOr(e.atk, 1)),
      speedMul: Math.max(0.01, numOr(e.speed, 1)),
    };
  }

  /**
   * Enemy multipliers of round r = the official table (baseEnemyScale; no custom multiplier), with the ENDLESS
   * compounding applied on top of the last official round once r runs past it (无尽模式, docs/ENDLESS.md):
   *
   *   r ≤ lastRound : the official table as-is
   *   r  > lastRound: enemyScale[lastRound] × growth^(r − lastRound)   per stat
   *
   * `defMul` is only produced here (the official table has no defence column; the endless spec adds +3 %/round).
   */
  enemyScale(r) {
    return roundScale(r, this);
  }

  /** Endless-mode settings (config.json `endless`, else `modes[*].endless`, else the DEFAULTS). */
  get endlessCfg() {
    const d = DEFAULTS.endless;
    const c = this.config && this.config.endless && typeof this.config.endless === 'object' ? this.config.endless : {};
    const m = this.mode.endless && typeof this.mode.endless === 'object' ? this.mode.endless : {};
    const pick = (k) => (m[k] !== undefined ? m[k] : c[k] !== undefined ? c[k] : d[k]);
    const gRaw = (m.growth && typeof m.growth === 'object' ? m.growth : null)
      || (c.growth && typeof c.growth === 'object' ? c.growth : null) || d.growth;
    const bRaw = (m.balance && typeof m.balance === 'object' ? m.balance : null)
      || (c.balance && typeof c.balance === 'object' ? c.balance : null) || d.balance;
    const bDefault = d.balance;
    return {
      eliteRounds: Math.max(1, Math.min(20, Number.isInteger(pick('eliteRounds')) ? pick('eliteRounds') : d.eliteRounds)),
      // The official rounds whose templates the loop's elite waves mirror, in wave order (null = derive instead).
      eliteTemplateRounds: (() => {
        const raw = pick('eliteTemplateRounds');
        if (!Array.isArray(raw)) return null;
        const rs = raw.filter((n) => Number.isInteger(n) && n > 0);
        return rs.length ? rs : null;
      })(),
      // An explicit pin for the wave templates (null when unset). Always an ARRAY here, so callers can read `.length`.
      eliteTemplates: (() => {
        const raw = pick('eliteTemplates');
        return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
      })(),
      growth: {
        hp: Math.max(1, numOr(gRaw.hp, d.growth.hp)),
        atk: Math.max(1, numOr(gRaw.atk, d.growth.atk)),
        def: Math.max(1, numOr(gRaw.def, d.growth.def)),
      },
      balance: {
        fromWave: Math.max(1, Number.isInteger(bRaw.fromWave) ? bRaw.fromWave : bDefault.fromWave),
        layerCut: numOr(bRaw.layerCut, bDefault.layerCut),
        lpGain: numOr(bRaw.lpGain, bDefault.lpGain),
        maxLp: Number.isFinite(bRaw.maxLp) && bRaw.maxLp > 0 ? bRaw.maxLp : null,
      },
      shop: (() => {
        const sRaw = (m.shop && typeof m.shop === 'object' ? m.shop : null)
          || (c.shop && typeof c.shop === 'object' ? c.shop : null) || d.shop;
        const dShop = d.shop;
        const items = Array.isArray(sRaw.items) && sRaw.items.length ? sRaw.items : dShop.items;
        return {
          maxLevel: Math.max(1, Number.isInteger(sRaw.maxLevel) ? sRaw.maxLevel : dShop.maxLevel),
          priceToMaxLevel: Math.max(0, numOr(sRaw.priceToMaxLevel, dShop.priceToMaxLevel)),
          specialSlots: Math.max(0, Number.isInteger(sRaw.specialSlots) ? sRaw.specialSlots : dShop.specialSlots),
          items,
        };
      })(),
      // 机变阶段 (SP_DRAFT) inside the loop: one per cycle, after the cycle's `afterWave`-th wave.
      draft: (() => {
        const dRaw = (m.draft && typeof m.draft === 'object' ? m.draft : null)
          || (c.draft && typeof c.draft === 'object' ? c.draft : null) || d.draft;
        const dDraft = d.draft;
        const fams = Array.isArray(dRaw.families)
          ? dRaw.families.filter((f) => Array.isArray(f) && typeof f[0] === 'string' && Number(f[1]) > 0)
          : null;
        const tiers = Array.isArray(dRaw.supplyTiers) && dRaw.supplyTiers.length === 2
          ? dRaw.supplyTiers.map((n) => numOr(n, 1)) : null;
        return {
          afterWave: Math.max(1, Number.isInteger(dRaw.afterWave) ? dRaw.afterWave : dDraft.afterWave),
          families: fams && fams.length ? fams.map((f) => [f[0], Number(f[1])]) : dDraft.families,
          cards: Number.isInteger(dRaw.cards) && dRaw.cards > 0 ? Math.min(6, dRaw.cards) : null,
          supplyTiers: tiers || dDraft.supplyTiers,
        };
      })(),
    };
  }

  /**
   * Is round r an endless round? The official rounds are 1..lastRound (14) plus the Hidden Core at `hiddenRound`
   * (15) — the core is a real round of the match and NOT part of the loop, so the first endless wave is
   * `hiddenRound + 1` (16), i.e. `lastRound + 2` where a Hidden Core exists.
   *
   * Gated on `endlessActive` too: before the vote passes, the loop's rounds do not exist yet, and the Hidden Core
   * itself must never be scaled by the loop's multipliers.
   */
  isEndlessRound(r) {
    return this._endlessActive === true && Number.isInteger(r) && r >= this.endlessFirstRound();
  }

  /**
   * The first endless wave. A cleared Hidden Core sits at `hiddenRound`, so the loop opens one round after it;
   * without a Hidden Core (modes that end on their boss round) it opens right after `lastRound`.
   */
  endlessFirstRound() {
    return (Number.isInteger(this.hiddenRound) ? this.hiddenRound : this.lastRound) + 1;
  }

  /** How many endless waves `r` is past the first one (1 for the first endless wave itself, 0 before it). */
  endlessStep(r) {
    return this.isEndlessRound(r) ? r - this.endlessFirstRound() + 1 : 0;
  }

  /**
   * Called by the Match when the endless vote passes (and only then).
   *
   * `register` (optional) is the match's MetaRegistry: the endless special items are not in data/items.json, so
   * registerBuiltins' data walk never sees them — their equip handler is registered here, under the item family key
   * PlayerState.equip looks up (`item:${itemKey(id)}`).
   */
  setEndlessActive(on, { register = null } = {}) {
    this._endlessActive = !!on;
    if (this._endlessActive && typeof register === 'function') registerEndlessItems(register, this);
    return this._endlessActive;
  }

  get endlessActive() {
    return this._endlessActive === true;
  }

  /**
   * Can this match offer the endless loop? It needs an official Hidden Core (so there is a "cleared the core" moment to
   * offer it after), at least one usable elite-wave template, and a boss pool to draw from.
   *
   * The template test asks the RESOLVED list (endlessEliteTemplates), not the raw config: the waves normally come from
   * `endless.eliteTemplateRounds` (the official rounds 8…13) with `eliteTemplates` left empty as a pin/escape hatch.
   */
  isEndlessAvailable() {
    if (this.hiddenRound == null) return false;
    if (!this.endlessEliteTemplates().length) return false;
    return this.endlessBossWeights().length > 0;
  }

  /**
   * Is `id` a template an endless ELITE wave may use? Leader templates are out entirely (their leader is a LITERAL
   * key with no tag, so a tag-only check would let them through and every "elite" round would spawn a boss), and the
   * template must actually hold at least one spawn slot.
   *
   * Normal-class placeholder slots (N / NF / S) are fine: an endless elite round escalates EVERY placeholder to the
   * round's elite pick (waves.js templateSpawns `escalate`), so no normal enemy can spawn from them.
   */
  endlessEliteTemplateOk(id) {
    const tpl = this.wave(id);
    const list = Array.isArray(tpl && tpl.spawns) ? tpl.spawns : [];
    if (!list.length) return false;
    const kind = tpl.kind || 'normal';
    if (kind === 'boss' || kind === 'hidden') return false;
    for (const s of list) {
      if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
      const tag = s.tag || null;
      if (tag === 'boss' || tag === 'part') return false;
      const key = s.key !== undefined ? s.key : s.enemyKey;
      if (typeof key === 'string' && key) return true;
    }
    return false;
  }

  /**
   * The templates of the endless loop's elite waves, in wave order (wave 1 first), repeating every cycle.
   *
   * The loop's 6 elite waves mirror the 6 elite rounds of the official run **in order**: wave 1 = round 8's template
   * (h01), wave 2 = round 9's (h02), … wave 6 = round 13's (h06), and then the cycle starts over — so cycle 2's wave 1
   * is h01 again, not a continuation of some wider rotation. Difficulty is carried by the compounding stat multipliers
   * (gamedata.roundScale), not by swapping templates, so the same wave number always means the same enemy composition.
   *
   * `endless.eliteTemplateRounds` picks the official rounds to mirror (default 8…13 = the six elite rounds);
   * `endless.eliteTemplates` pins an explicit template list instead. Anything unusable falls back to the derived
   * elite-capable list, so a data update can never empty the loop.
   */
  endlessEliteTemplates() {
    const cfg = this.endlessCfg;
    if (Array.isArray(cfg.eliteTemplates) && cfg.eliteTemplates.length) {
      const pinned = cfg.eliteTemplates.filter((id) => this.endlessEliteTemplateOk(id));
      if (pinned.length) return pinned;
    }
    const rounds = Array.isArray(cfg.eliteTemplateRounds) ? cfg.eliteTemplateRounds : [];
    const out = [];
    for (const r of rounds) {
      const rc = this.roundCfg(r);
      const id = rc && typeof rc.template === 'string' ? rc.template : null;
      if (id && this.endlessEliteTemplateOk(id)) out.push(id);
    }
    if (out.length) return out;
    // fallback: every elite-capable template in the data, in id order (the pre-8-13 behaviour)
    const all = [];
    for (const id of Object.keys(this.raw.waves || {})) if (this.endlessEliteTemplateOk(id)) all.push(id);
    all.sort();
    return all;
  }

  /** Cycle position of endless round r: 0-based wave inside the elite + boss cycle. */
  endlessCyclePos(r) {
    const n = this.endlessCfg.eliteRounds + 1;
    return ((this.endlessStep(r) - 1) % n + n) % n;
  }

  /**
   * Does endless round r open with a 机变阶段 (SP_DRAFT)? The official run holds its own at rounds 3 / 9 / 11; the loop
   * keeps the beat ONCE PER CYCLE: the THIRD wave of every cycle (6 elite + 1 boss) opens with one.
   *
   * `afterWave: 3` (cycle positions are 0-based, so wave 3 = position 2) ⇒ cycle 1: wave 3 is round 18, so round 19
   * opens with the 机变; cycle 2: wave 3 is round 25 → round 26; cycle 3: round 32 → 33 … — exactly one per cycle,
   * always right after that cycle's third wave. It never lands on a boss wave (position 6 of the cycle is the boss,
   * position 3 is not), so a cycle always reads: 3 waves → 机变 → 3 waves → 领袖.
   */
  isEndlessDraftRound(r) {
    if (!this.isEndlessRound(r)) return false;
    const n = this.endlessCfg.eliteRounds + 1;                 // waves per cycle (6 elite + 1 boss = 7)
    const prev = ((this.endlessStep(r) - 2) % n + n) % n;      // the cycle position of the wave that just ended
    return this.endlessCyclePos(r) === this.endlessCfg.draft.afterWave && prev === this.endlessCfg.draft.afterWave - 1;
  }

  /**
   * The 机变阶段 schedule of an endless draft round. Mirrors the official R11 entry (the richest one in
   * `data/choices.json`): the mixed bounty / shop / tactic families and tier-4..6 supply, with the card count from the
   * format (solo 3 / multi 6) unless `draft.cards` pins it. `bountyDraftKind(round)` already maps r ≥ 11 to 'hunter'.
   */
  endlessDraftSchedule() {
    const cfg = this.endlessCfg.draft;
    return {
      families: cfg.families.map(([family, weight]) => ({ family, weight })),
      cards: cfg.cards ?? (this.isSolo ? 3 : 6),
      supplyTiers: cfg.supplyTiers.slice(),
      bountyDraft: 'hunter',
    };
  }

  /** Is endless round r the cycle's boss round? (the last position of every cycle) */
  isEndlessBossRound(r) {
    return this.isEndlessRound(r) && this.endlessCyclePos(r) === this.endlessCfg.eliteRounds;
  }

  /**
   * Template of an endless ELITE wave: the cycle position picks the entry of `endlessEliteTemplates()` (wave 1 = the
   * first entry), so the SAME wave number always fields the SAME composition — cycle 1's wave 1 and cycle 3's wave 1
   * are both round 8's template. The difficulty difference between cycles comes from the compounding multipliers, not
   * from the template.
   *
   * The boss position (cyclePos === eliteRounds) never asks for a template: waves.js routes it to buildBossWave.
   */
  endlessEliteTemplate(r) {
    const list = this.endlessEliteTemplates();
    if (!list.length) return null;
    const pos = this.endlessCyclePos(r);
    return list[pos % list.length];
  }

  /**
   * Endless boss draws from the Final Assault AND Hidden Core pools together (the round-14 and round-15 pools),
   * as { id: weight } pairs, with the two pools' weights summed when an id appears in both.
   */
  endlessBossWeights() {
    const out = new Map();
    const add = (w) => {
      if (!w || typeof w !== 'object') return;
      for (const [id, v] of Object.entries(w)) {
        if (!this.boss(id)) continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) continue;
        out.set(id, (out.get(id) || 0) + n);
      }
    };
    add(this.mode.bossWeights);
    add(this.mode.hiddenBossWeights);
    return [...out.entries()];
  }

  /** hp multiplier for an endless boss's shared pool (same compounding as the escort stats). */
  endlessBossPoolMul(r) {
    const st = this.endlessStep(r);
    return st > 0 ? Math.pow(this.endlessCfg.growth.hp, st) : 1;
  }

  /**
   * The player-side balance applied when endless wave `r` ENDS (Match.settle): { layerCut, lpGain, maxLp } or null.
   *
   * `balance.fromWave` counts ENDLESS waves, so with fromWave 2 the first endless wave (round 16, the loop's own
   * first wave) passes untouched and the cut starts with the wave after it.
   */
  endlessBalance(r) {
    const st = this.endlessStep(r);
    if (st <= 0) return null;
    const b = this.endlessCfg.balance;
    if (st < b.fromWave) return null;
    return b;
  }

  /** Timer key for endless rounds (reuse the boss timers past the last round). */
  timer(key) {
    const t = this.config.timers && this.config.timers[key];
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : DEFAULTS.timers[key] ?? 10;
  }

  get lpCapPerRound() { return posIntOr(this.config.lpCapPerRound, DEFAULTS.lpCapPerRound); }
  /**
   * Boss overtime (`bossTurnHpReduceTime` 150 / 1 LP per second): a server turn timer of turnInfoDataDict like
   * prepPhaseTime, so REAL seconds on the same clock as the boss level's 120 s maxPlayTime (combat limits are real
   * seconds, docs/BALANCE.md §2.1) — the level countdown runs out first, the battle continues, and the merged team LP
   * drains 1 per real second from the 150 s mark (research 01 §10, 06 §11.7). Read as game seconds the drain would
   * start at 75 real s (45 s before the countdown ends) at 2 LP per real second.
   */
  get bossOvertimeAfterReal() { return Math.max(0, numOr(this.config.bossOvertimeAfter, DEFAULTS.bossOvertimeAfter)); }
  /** Team LP drained per REAL second of overtime. */
  get bossOvertimeDrainReal() { return Math.max(0, numOr(this.config.bossOvertimeDrainPerSec, DEFAULTS.bossOvertimeDrainPerSec)); }
  /** Overtime start in GAME seconds of a boss field clock (150 real s × the forced 2× = 300). */
  get bossOvertimeAfter() { return this.bossOvertimeAfterReal * this.combatTimeScale; }
  /** Team LP drained per GAME second of overtime (1 per real second = 0.5 per game second). */
  get bossOvertimeDrain() { return this.bossOvertimeDrainReal / this.combatTimeScale; }
  /**
   * Team LP the overtime drain has taken when a boss field clock reads `gt` game seconds: bossOvertimeDrainReal per
   * whole REAL second past bossOvertimeAfterReal (the first point at 151 real s).
   */
  bossOvertimeDue(gt) {
    const over = (Number(gt) || 0) / this.combatTimeScale - this.bossOvertimeAfterReal;
    return over >= 1 ? Math.floor(over) * this.bossOvertimeDrainReal : 0;
  }
  get dp() {
    const d = this.config.dp && typeof this.config.dp === 'object' ? this.config.dp : {};
    return { dpInit: numOr(d.init, 10), dpPerSec: numOr(d.perSec, 1), dpMax: numOr(d.max, 99) };
  }
  get unite() {
    const u = this.config.unite && typeof this.config.unite === 'object' ? this.config.unite : {};
    return {
      maxHelpers: posIntOr(u.maxHelpers, DEFAULTS.unite.maxHelpers),
      templates: u.templates && typeof u.templates === 'object' ? u.templates : DEFAULTS.unite.templates,
    };
  }
  get hiddenCore() {
    const h = this.config.hiddenCore && typeof this.config.hiddenCore === 'object' ? this.config.hiddenCore : {};
    return {
      single: numOr(h.single, DEFAULTS.hiddenCore.single),
      multi: numOr(h.multi, DEFAULTS.hiddenCore.multi),
      minTeamLpExclusive: numOr(h.minTeamLpExclusive, DEFAULTS.hiddenCore.minTeamLpExclusive),
      difficulties: Array.isArray(h.difficulties) ? h.difficulties : DEFAULTS.hiddenCore.difficulties,
    };
  }
  bans(difficulty) {
    const b = this.config.bans && this.config.bans[difficulty];
    const d = DEFAULTS.bans[difficulty] || { core: 0, addon: 0 };
    if (!b || typeof b !== 'object') return { ...d };
    return { core: Number.isInteger(b.core) && b.core >= 0 ? b.core : d.core, addon: Number.isInteger(b.addon) && b.addon >= 0 ? b.addon : d.addon };
  }
  get bandDraft() {
    const b = this.config.bandDraft && typeof this.config.bandDraft === 'object' ? this.config.bandDraft : {};
    return {
      skipsPerPlayer: Number.isInteger(b.skipsPerPlayer) && b.skipsPerPlayer >= 0 ? b.skipsPerPlayer : DEFAULTS.bandDraft.skipsPerPlayer,
      timeoutBandId: typeof b.timeoutBandId === 'string' && this.band(b.timeoutBandId) ? b.timeoutBandId : this.defaultBandId,
    };
  }

  /** Bosses weights for the boss round / hidden round. */
  bossWeights(hidden = false) {
    const w = hidden ? this.mode.hiddenBossWeights : this.mode.bossWeights;
    return w && typeof w === 'object' ? Object.entries(w).filter(([id, v]) => this.boss(id) && Number(v) > 0) : [];
  }

  /** Band usable in this mode type. */
  bandAllowed(bandId) {
    const b = this.band(bandId);
    if (!b) return false;
    const list = Array.isArray(b.modeTypeList) ? b.modeTypeList : null;
    if (!list) return true;
    return list.includes(this.isSolo ? 'SINGLE' : 'MULTI');
  }

  bandIds() {
    const bands = this.raw.bands && typeof this.raw.bands === 'object' ? this.raw.bands : {};
    return Object.keys(bands).filter((id) => this.bandAllowed(id)).sort((a, b) => numOr(bands[a].sortId, 99) - numOr(bands[b].sortId, 99) || (a < b ? -1 : 1));
  }

  startLp(bandId) {
    const b = this.band(bandId);
    return b && Number.isInteger(b.totalHp) && b.totalHp > 0 ? b.totalHp : this.defaultStartLp;
  }

  /**
   * The bonds a strategy's mechanic is built around (DESIGN §21.26): bands.json `bondIds`, written at build time by
   * shared/bandBonds.js from the band's own text and blackboards (潘格尼尼 → 拉特兰, 克莱门莎 → 阿戈尔, 玛恩纳 → 卡西米尔 …) —
   * the field the strategy draft's 本局禁用 mark reads too. Known bond ids in data order; [] for an unknown band, one tied to
   * no bond (华法琳, 阿米娅 …) or data without the field. The bot never picks a strategy tied to a bond the mode switches
   * off (bot.js botPickBand).
   * @param {string} bandId
   * @returns {string[]}
   */
  bandBondIds(bandId) {
    if (this._bandBonds.has(bandId)) return this._bandBonds.get(bandId);
    const listed = this.band(bandId)?.bondIds;
    const set = new Set(Array.isArray(listed) ? listed : []);
    const out = Object.freeze(this.bondIds.filter((id) => set.has(id)));
    this._bandBonds.set(bandId, out);
    return out;
  }

  /**
   * Placeable (hand) tokens a chess sends to the hand when placed on the board: [{ tokenId, count }] — its manually
   * deployable summons (tokens.json `placeable`: 医疗探机, 诅咒娃娃, 海嗣, 狼群, 流形, 爬行号·防护单元; user playtest #6)
   * that the chess makes under `loadout` ({ skillIndex } from shared/protocol.js resolveLoadout; absent ⇒ its default
   * skill): the owner variant's `sources` (`bySkill[skillIndex]` for a non-default skill) name a talent or a skill —
   * 赫默 / 巫恋 on S1 make no drone / doll. `count` = the summon's deploy limit (PRTS 卫戍协议/帮助 "根据召唤物部署数量
   * 上限（非初始持有量），发送等量召唤物至手牌区": 凯瑟琳 2 of her 3 devices).
   */
  placeableTokens(chessId, loadout = null) {
    const c = this.chess(chessId);
    if (!c || !Array.isArray(c.tokens)) return [];
    const out = [];
    for (const tid of c.tokens) {
      const t = this.token(tid);
      if (!t || t.kind !== 'summon' || t.placeable !== true) continue;
      const vs = t.variants && typeof t.variants === 'object' ? t.variants : {};
      const v = vs[chessId] ?? vs[String(chessId).replace(/_b$/, '_a')] ?? null;
      if (v) {
        const alt = loadout && Number.isInteger(loadout.skillIndex) && v.bySkill ? v.bySkill[loadout.skillIndex] : null;
        const src = Array.isArray(alt?.sources) ? alt.sources : Array.isArray(v.sources) ? v.sources : [];
        if (!src.includes('talent') && !src.includes('skill')) continue;
      }
      const count = posIntOr(v?.stats?.deployLimit, posIntOr(t.deployLimit, 1));
      out.push({ tokenId: tid, count: Math.min(count, 9) });
    }
    return out;
  }
}
