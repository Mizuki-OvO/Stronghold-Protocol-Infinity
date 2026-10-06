// dev-bridge.mjs — 本地服「数值修改器」的生效层 (dev only, 不属于游戏本体)。
//
// 思路：不在运行中改 data/*.json（那是生成的、被 deepFreeze、且被模块导入缓存），而是把数值插在
// 「读取点」上。两个生效时机：
//
//   1) 数据层   — GameData 的 config / mode / economy 三个字段本来就是**可写的实例字段**，
//                 指向 data/config.json 的（冻结的）切片。构造之后把它们换成深拷贝就得到可变副本；
//                 每回合重放一遍 lobby 覆盖 → 面板改的数值既对新开的局生效，也对已开的局生效。
//   2) 对局层   — 包一层 Match.startRound，在每个回合节点把「目标值」写回玩家状态
//                 （生命值、金币、商店等级、羁绊层数），所以每回合都会被重新拉到你要的值上。
//   外加几个方法级补丁（起手生命值、商店等级上限、无限刷新）。
//
// 面板 (dev-server.mjs) 只通过本模块导出的函数读写，不直接碰游戏对象。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** PHASE → 中文名（面板显示用；client 侧同名的表在 shared/constants.js）。 */
const PHASE_NAMES = {
  LOBBY: '等待中', INFO_CHECK: '确认本局信息', BAND_DRAFT: '选择策略', BATTLE_CHECK: '协议启动',
  ROUND_START: '回合开始', SP_DRAFT: '机变阶段', PREP: '休整期', COMBAT: '作战中', UNITE: '联防阶段',
  SETTLE: '结算', FINAL_ASSAULT: '最终攻势', HIDDEN_CORE: '隐秘核心',
  ENDLESS_PROMPT: '无尽模式', RESULT: '模拟结束',
};

/** 落盘文件：面板每次改动都写这里，重开还在。 */
export const OVERRIDES_FILE = path.join(ROOT, 'dev-overrides.json');

// ---------------------------------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------------------------------

/** 本次进程的覆盖表（结构见 dev-overrides.json 的 _doc）。 */
export const ov = {
  lobby: {},   // 数据层：config / mode 上的点路径 → 值
  match: {},   // 对局层：本局所有玩家（lp / funds / shopLevel / bonds）
  me: {},      // 玩家层：playerId → 同上，比 match 更具体
  patch: {},   // 方法级开关 { qa: {...} }
};

/** 面板读盘用的基础值（直接读 data/config.json，不受覆盖影响）。 */
const base = { config: null, economy: {}, modes: {}, modeEnemyScale: {} };

const live = { gd: null, match: null, server: null };
/** 已经打过 lobby 覆盖的 GameData 实例 → 当时的签名（覆盖一变就重打）。 */
const patched = new WeakMap();

/**
 * Dev-only runtime state that is NOT part of the override file (it describes a one-shot action, not a value):
 *   * targetRound    — the round the next `Match.startRound` must use instead of the engine's own number
 *   * phaseDeadline  — the current phase's timeout callback, kept so 「跳过当前阶段」 can fire it early
 */
const devState = {
  targetRound: null,
  phaseDeadline: null,
  startRoundWrapped: false,
  deadlineWrapped: false,
};

let _dirty = true;
const listeners = new Set();
/** 面板改动后立刻套用（不等下一回合）。 */
export function onApply(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function fire() { _dirty = true; for (const fn of listeners) { try { fn(); } catch { /* 面板侧自己兜 */ } } }
export function markDirty() { fire(); }

// ---------------------------------------------------------------------------------------------------
// 点路径工具
// ---------------------------------------------------------------------------------------------------
const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

export function getPath(obj, p) {
  let cur = obj;
  for (const k of String(p).split('.')) {
    if (!isPlain(cur) && !Array.isArray(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 写点路径（数组下标也走这里）。冻结对象上写会失败 → 返回 false。 */
export function setPath(obj, p, v) {
  const keys = String(p).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!isPlain(cur[k]) && !Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  try { cur[keys[keys.length - 1]] = v; return true; } catch { return false; }
}

export function delPath(obj, p) {
  const keys = String(p).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur = cur && cur[keys[i]];
    if (cur == null) return;
  }
  try { delete cur[keys[keys.length - 1]]; } catch { /* ignore */ }
}

const num = (v, d = 0) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return d;
};
const int = (v, d = 0) => Math.trunc(num(v, d));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const LAYER_CAP = 999;

/** 结构式深拷贝：只保留 JSON 能表达的东西（config 切片本来就是 JSON）。 */
function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (isPlain(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = deepCopy(v[k]); return o; }
  return v;
}

// ---------------------------------------------------------------------------------------------------
// 1) 数据层
// ---------------------------------------------------------------------------------------------------

/** 读 data/config.json 原文，记下基础值供面板显示。 */
export function loadBaseConfig(dir = path.join(ROOT, 'data')) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  base.config = raw;
  base.economy = raw.economy || {};
  base.modes = raw.modes || {};
  base.modeEnemyScale = {};
  for (const [mid, m] of Object.entries(base.modes)) if (m && m.enemyScale) base.modeEnemyScale[mid] = m.enemyScale;
  return raw;
}

let _lobbySig = null;

function lobbySig() { return JSON.stringify(ov.lobby); }

/**
 * 把 lobby 覆盖写进一个 GameData 实例。
 *
 * GameData 只在「值变了」的时候才重建切片，所以面板反复调也没关系；重建会把实例字段换成可变深拷贝，
 * 冻结的原始 data 一个字节都不动。
 */
export function applyLobbyTo(gd) {
  if (!gd || typeof gd !== 'object') return 0;
  const sig = lobbySig();
  if (patched.get(gd) === sig) return 0;
  patched.set(gd, sig);
  const keys = Object.keys(ov.lobby);

  // config / economy：整体深拷贝一次再逐路径写（gd.economy 是 config.economy 的引用，
  // 必须连它一起换掉，否则写的是原始 data 里那个冻结对象）。没有覆盖时也重建一次 —— 这正好是
  // 「删掉一个覆盖」的还原路径（从冻结的原始 config 重新拷一份干净的）。
  const rawCfg = gd.raw && gd.raw.config;
  gd.config = deepCopy(rawCfg && typeof rawCfg === 'object' ? rawCfg : gd.config || {});
  gd.economy = gd.config.economy && typeof gd.config.economy === 'object' ? gd.config.economy : {};
  // raw 只浅拷贝：chess / bonds / enemies 等大表继续共享（它们没有被覆盖，冻结也无所谓）
  gd.raw = { ...(gd.raw || {}), config: gd.config };
  // mode：只有被 mode.* 覆盖时才重建（否则保持原对象，省一次深拷贝）
  if (keys.some((k) => k.startsWith('mode.'))) {
    const src = rawCfg && rawCfg.modes ? rawCfg.modes[gd.modeId] : gd.mode;
    gd.mode = deepCopy(src && typeof src === 'object' ? src : gd.mode || {});
  }

  let n = 0;
  for (const p of keys) {
    if (p.startsWith('mode.')) { if (setPath(gd.mode, p.slice(5), ov.lobby[p])) n++; }
    else if (setPath(gd.config, p, ov.lobby[p])) n++;
  }
  if (!live.gd) live.gd = gd;
  return n;
}

/** 兼容旧名。 */
export const applyLobby = applyLobbyTo;

// ---------------------------------------------------------------------------------------------------
// 2) 方法级补丁
// ---------------------------------------------------------------------------------------------------

/**
 * 在 startServer **之前** 调用。只覆盖原型方法，不碰任何文件。
 */
export function installMethodPatches({ GameData, PlayerState, Match, dataMod, endlessItemRecord }) {
  const qa = () => ov.patch.qa || {};
  live.GameData = GameData;
  live.dataMod = dataMod || null;
  live.buildEndlessItem = endlessItemRecord || null;
  const orig = {
    startRound: Match.prototype.startRound,
    startLp: GameData.prototype.startLp,
    defaultStartLp: Object.getOwnPropertyDescriptor(GameData.prototype, 'defaultStartLp'),
    maxShopLevel: Object.getOwnPropertyDescriptor(GameData.prototype, 'maxShopLevel'),
    refresh: PlayerState.prototype.refresh,
  };
  if (!orig.defaultStartLp || !orig.maxShopLevel) throw new Error('dev-bridge: gamedata.js 的 getter 结构变了');

  // 起手生命值：两种路径都要压住 —— defaultStartLp（无 band 时）和 startLp（band 自带 totalHp 时）
  const wantLp = () => {
    const v = ov.lobby['economy.startLp'] ?? ov.lobby['economy.defaultStartLp'];
    return Number.isInteger(v) && v > 0 ? v : null;
  };
  Object.defineProperty(GameData.prototype, 'defaultStartLp', {
    configurable: true, enumerable: true,
    get() {
      const v = wantLp();
      if (v !== null) return v;
      return orig.defaultStartLp.get.call(this);
    },
  });
  GameData.prototype.startLp = function devStartLp(bandId) {
    const v = wantLp();
    if (v !== null) return v;
    return orig.startLp.call(this, bandId);
  };

  // 商店等级上限（无尽模式的 7 级仍然生效，取两者较大）
  Object.defineProperty(GameData.prototype, 'maxShopLevel', {
    configurable: true, enumerable: true,
    get() {
      const b = orig.maxShopLevel.get.call(this);
      const v = qa().shopLevelCap;
      return Number.isInteger(v) && v > 0 ? Math.max(b, v) : b;
    },
  });

  // 无限刷新
  PlayerState.prototype.refresh = function devRefresh(...args) {
    if (qa().freeRefresh) this.shop.freeRefreshes = 99;
    const out = orig.refresh.apply(this, args);
    if (qa().freeRefresh) this.shop.freeRefreshes = 99;
    return out;
  };

  // 回合节点：套用玩家目标值（lobby 覆盖在构造时已经套过，这里再确认一次），并让「目标回合」在边界上精确接管
  if (!devState.startRoundWrapped) {
    const base = Match.prototype.startRound;
    devState.startRoundWrapped = true;
    Match.prototype.startRound = function devStartRound(r) {
      // 「跳回合」: the request is applied HERE and nowhere else — the one place where the round number is
      // authoritative. `r` is the number the engine was about to use (natural progression, or the endless first
      // wave); the request replaces it and is then consumed, so a jump happens exactly once.
      const want = devState.targetRound;
      if (Number.isInteger(want) && want > 0 && this.round !== want) {
        devState.targetRound = null;
        r = want;
      }
      applyLobbyTo(this.gd);
      refreshDerived(this.gd);
      // Jumping into an endless round must ALSO switch the loop on, or the round runs with the official round-14
      // stats (`gd.enemyScale` only compounds while the loop is live) — the fight would be trivially easy and the
      // endless balance (削层/回血) would not run. Do exactly what the real entry does, before the engine reads it.
      try { ensureEndlessFor(this, r); } catch (e) { warn('ensureEndless', e); }
      if (r === 1 || live.match == null) live.match = this;
      const out = base.call(this, r);
      try { applyMatch(this, 'round'); } catch (e) { warn('startRound', e); }
      return out;
    };
  }

  // 阶段截止：记下回调，好让面板「跳过当前阶段」立刻把它跑掉（而不是把计时器改成 0 —— 那样结束不了战斗）
  if (!devState.deadlineWrapped) {
    const baseDeadline = Match.prototype.setDeadline;
    devState.deadlineWrapped = true;
    Match.prototype.setDeadline = function devSetDeadline(seconds, fn, opts) {
      if (typeof fn === 'function') devState.phaseDeadline = { fn, phase: this.phase, round: this.round };
      else devState.phaseDeadline = null;
      return baseDeadline.call(this, seconds, fn, opts);
    };
  }

  return orig;
}

/**
 * 造一个 Match 子类，交给 `startServer({ MatchClass })`。
 *
 * 为什么需要它：server/index.js 传的是 `MatchClass: opts.MatchClass`（显式传了 undefined），于是
 * lobby.js 的解构默认值（真正的 Match）不会生效 —— 实际跑的是 `server/match/StubMatch.js` 那个空壳。
 * 面板要跟着真实对局走，就得把真正的 Match 显式交进去；顺便在构造时就套上 lobby 覆盖，
 * 让 GameData 从 config 派生出来的状态（无尽特殊道具表等）也是覆盖后的版本。
 */
export function makeTrackedMatchClass(RealMatch) {
  const Tracked = class DevTrackedMatch extends RealMatch {
    constructor(opts) {
      super(opts);
      try {
        applyLobbyTo(this.gd);
        live.match = this;
      } catch (e) { warn('ctor', e); }
    }
  };
  Object.defineProperty(Tracked, 'name', { value: RealMatch.name, configurable: true });
  live.MatchClass = Tracked;
  return Tracked;
}

/**
 * GameData 构造时会从 config 派生一小部分状态（目前只有无尽模式的特殊道具表 _endlessItemMap）。
 * 对局已经开着的时候改了 config，就在下一个回合把这些派生项重算一遍 —— 只在覆盖里真的碰到
 * 相关路径时才做，平时零开销。
 */
function refreshDerived(gd) {
  if (!gd || !gd._endlessItemMap) return;
  const touched = Object.keys(ov.lobby).some((k) => k.startsWith('endless.shop.items'));
  if (!touched) return;
  const specs = gd.endlessCfg && Array.isArray(gd.endlessCfg.shop.items) ? gd.endlessCfg.shop.items : [];
  const build = live.buildEndlessItem;
  if (!build) return;
  const map = {};
  for (const spec of specs) {
    const rec = build(spec);
    if (rec) map[rec.id] = rec;
  }
  Object.assign(gd._endlessItemMap, map);
  for (const id of Object.keys(gd._endlessItemMap)) if (!map[id]) delete gd._endlessItemMap[id];
}

/**
 * If `r` is an endless round but the match is not in the loop yet, enter it — the same two steps `_beginEndless`
 * performs: flip `gd.setEndlessActive(true)` (which also registers the special items' equip handler) and raise the
 * match's own `endless` flag. Idempotent.
 *
 * Needed because a dev jump can land past `endlessFirstRound` from a match that never cleared the Hidden Core; without
 * this the round would use the official round-14 stats and none of the loop's rules (compounding, 机变, shop 7).
 */
function ensureEndlessFor(m, r) {
  const gd = m.gd;
  if (!gd || gd.endlessActive) return false;
  // `isEndlessRound` is gated on endlessActive, so decide from the rounds themselves
  const first = gd.endlessFirstRound();
  if (!Number.isInteger(r) || r < first) return false;
  gd.setEndlessActive(true, { register: (key, handler) => m.registry.register(key, handler) });
  m.endless = true;
  if (!Number.isInteger(m.endlessRound) || m.endlessRound < 0) m.endlessRound = 0;
  m.tickerText?.('无尽模式（修改器跳转）', 25);   // FLOW_TICKER_PRIORITY
  return true;
}

function warn(where, e) { console.log(`[dev-bridge] ${where} 套用失败: ${(e && e.message) || e}`); }

// ---------------------------------------------------------------------------------------------------
// 3) 玩家 / 对局
// ---------------------------------------------------------------------------------------------------

/** 一个玩家的目标值：me 覆盖 match。 */
function targetFor(ps) {
  const m = ov.match || {}, me = (ov.me && ov.me[ps.playerId]) || {};
  return {
    lp: me.lp ?? m.lp,
    funds: me.funds ?? m.funds,
    shopLevel: me.shopLevel ?? m.shopLevel,
    bonds: me.bonds ?? m.bonds,
    bondsMode: me.bondsMode ?? m.bondsMode,
  };
}

/**
 * 把目标值写回一个玩家。
 * @param {any} ps
 * @param {'round'|'live'} when round = 回合节点；live = 面板按钮（两者都只动明确写了的项）
 */
export function applyPlayer(ps, when = 'live') {
  if (!ps || ps.left) return 0;
  const t = targetFor(ps);
  let n = 0;
  const gd = ps.gd;
  if (gd) applyLobbyTo(gd);

  if (t.lp !== undefined) {
    const v = int(t.lp, ps.lp);
    if (v !== ps.lp) { ps.lp = v; if (ps.dirty) ps.dirty(); n++; }
  }
  if (t.funds !== undefined) {
    const v = Math.max(0, int(t.funds, ps.funds));
    if (v !== ps.funds) { ps.funds = v; if (ps.dirty) ps.dirty(); n++; }
  }
  if (t.shopLevel !== undefined && gd) {
    const v = clamp(int(t.shopLevel, ps.shop.level), 1, Math.max(1, gd.maxShopLevel));
    if (v !== ps.shop.level) { ps.shop.level = v; ps.shop.upgradePrice = gd.upgradeBase(v) ?? 0; n++; }
  }
  if (t.bonds && typeof t.bonds === 'object' && gd) {
    const mode = t.bondsMode === 'set' ? 'set' : 'atLeast';
    let touched = 0;
    for (const [id, rawV] of Object.entries(t.bonds)) {
      if (!gd.bond(id)) continue;
      const v = clamp(int(rawV, 0), 0, LAYER_CAP);
      const before = Number.isFinite(ps.layers[id]) ? ps.layers[id] : 0;
      const next = mode === 'set' ? v : Math.max(before, v);
      if (next !== before) { ps.layers[id] = next; touched++; }
    }
    if (mode === 'set' && touched) {
      for (const id of Object.keys(ps.layers)) {
        if (!Object.hasOwn(t.bonds, id) && ps.layers[id] !== 0) { ps.layers[id] = 0; touched++; }
      }
    }
    if (touched) { try { if (ps.recompute) ps.recompute(); } catch (e) { warn('recompute', e); } n += touched; }
  }
  void when;
  return n;
}

/**
 * 把覆盖表套到整局。
 * @param {any} [m] Match（缺省 = 最近一局）
 * @param {'round'|'live'} [when]
 * @param {string|null} [onlyPlayerId]
 */
export function applyMatch(m, when = 'live', onlyPlayerId = null) {
  m = m || live.match;
  if (!m) return 0;
  if (m.gd) applyLobbyTo(m.gd);
  let n = 0;
  for (const ps of m.players.values()) {
    if (onlyPlayerId && ps.playerId !== onlyPlayerId) continue;
    n += applyPlayer(ps, when);
  }
  if (when === 'live' && n && m.markPublic) m.markPublic();
  if (when === 'round') _dirty = false;
  return n;
}

/** 面板动作：清空羁绊层数（layer=0）。 */
export function clearPlayerBonds(playerId) {
  const m = live.match;
  if (!m) return 0;
  const ps = playerId ? m.players.get(playerId) : null;
  const targets = ps ? [ps] : [...m.players.values()];
  let n = 0;
  for (const p of targets) {
    for (const id of Object.keys(p.layers)) if (p.layers[id] !== 0) { p.layers[id] = 0; n++; }
    try { if (p.recompute) p.recompute(); } catch (e) { warn('clearBonds', e); }
  }
  if (n && m.markPublic) m.markPublic();
  return n;
}

export function currentMatch() { return live.match; }
export function currentGd() { return live.gd; }
export function setLive({ gd, match, server } = {}) {
  if (gd !== undefined) live.gd = gd;
  if (match !== undefined) live.match = match;
  if (server !== undefined) live.server = server;
}

// ---------------------------------------------------------------------------------------------------
// 回合控制
// ---------------------------------------------------------------------------------------------------

/** 会「跳」的相位：这些相位由阶段计时器驱动，跳过它们不会破坏已经跑起来的东西。 */
const SKIPPABLE = new Set(['LOBBY', 'INFO_CHECK', 'BAND_DRAFT', 'ROUND_START', 'SP_DRAFT', 'PREP', 'SETTLE', 'UNITE', 'ENDLESS_PROMPT']);

/** 现在能不能跳阶段 / 跳回合（战斗和领袖战不行：它们由战斗模拟驱动，没有「阶段到期」这回事）。 */
export function roundControlState() {
  const m = live.match;
  if (!m) return { canJump: false, reason: '还没有对局' };
  const phase = m.phase;
  if (m.ended) return { canJump: false, phase, reason: '本局已结束' };
  if (!SKIPPABLE.has(phase)) {
    return { canJump: false, phase, reason: phase === 'COMBAT' ? '作战进行中（结算后自动推进到下一回合）' : `${phase} 阶段不能跳过` };
  }
  const d = devState.phaseDeadline;
  const hasTimer = !!(d && d.fn);
  return {
    canJump: true,
    phase,
    // PREP / 机变 in a solo match are untimed: there is no deadline to fire, the player must ready up
    canSkipPhase: hasTimer,
    skipHint: hasTimer ? null : '这个阶段没有倒计时（独立模拟的休整期/机变不限时），请点「准备就绪」或打完这一波',
    round: m.round,
  };
}

/**
 * 请求跳到第 `r` 回合。
 *
 * 不改「当前正在跑的回合」—— 那会让已经生成的出怪、结算里的回合号、联机同步互相打架。它做的是：
 * 在下一次 `Match.startRound` 被调用时，把引擎原本要用的回合号换成 `r`（一次性，用完即清）。
 *
 * 于是语义很干净：**从现在算起，下一个回合就是第 r 回合**。下一波出怪、难度倍率、无尽模式步进
 * 全部按 r 计算。战斗中随时可以点，等这一波结算完就跳过去。
 */
export function setTargetRound(r) {
  const m = live.match;
  const n = Math.trunc(Number(r));
  if (!m) return { ok: false, error: '还没有对局' };
  if (m.ended) return { ok: false, error: '本局已结束' };
  if (!Number.isInteger(n) || n < 1 || n > 999) return { ok: false, error: '回合号要在 1–999 之间' };
  if (n === m.round) { devState.targetRound = null; return { ok: true, target: null, note: `已经在第 ${n} 回合` }; }
  devState.targetRound = n;
  return {
    ok: true,
    target: n,
    note: m.round > n
      ? `下一回合将回到第 ${n} 回合（回退：难度倍率/出怪按第 ${n} 回合算）`
      : `下一回合将直接跳到第 ${n} 回合`,
  };
}

export function clearTargetRound() {
  devState.targetRound = null;
  return { ok: true, target: null };
}

export function targetRound() { return devState.targetRound; }

/**
 * 跳过当前阶段：立刻执行这个阶段的「倒计时到期」回调（不是把计时器改成 0 —— 那样会结束不了战斗、
 * 留下半截状态）。
 *
 * 只对由阶段计时器驱动的相位有效；作战/领袖战由战斗模拟驱动，没有可跳过的到期回调。
 */
export function skipPhase() {
  const m = live.match;
  if (!m) return { ok: false, error: '还没有对局' };
  if (m.ended) return { ok: false, error: '本局已结束' };
  const st = roundControlState();
  if (!st.canJump) return { ok: false, error: st.reason };
  const d = devState.phaseDeadline;
  if (!d || typeof d.fn !== 'function') {
    return { ok: false, error: st.skipHint || '这个阶段没有可跳过的倒计时' };
  }
  if (d.phase !== m.phase || d.round !== m.round) {
    return { ok: false, error: '阶段已经变了，请刷新后重试' };
  }
  const fn = d.fn;
  devState.phaseDeadline = null;
  const from = { phase: m.phase, round: m.round };
  try { fn(); } catch (e) { return { ok: false, error: `跳过失败: ${e.message}` }; }
  return { ok: true, from, to: { phase: m.phase, round: m.round } };
}

// ---------------------------------------------------------------------------------------------------
// 面板读盘
// ---------------------------------------------------------------------------------------------------

export function baseValues() {
  return { economy: base.economy, modes: base.modes, modeEnemyScale: base.modeEnemyScale };
}

/** 当前对局快照。 */
export function matchView() {
  const m = live.match;
  if (!m) return null;
  const players = [];
  for (const ps of m.players.values()) {
    const layers = {};
    for (const [k, v] of Object.entries(ps.layers || {})) if (v) layers[k] = v;
    players.push({
      playerId: ps.playerId, name: ps.name, seat: ps.seat,
      isBot: !!ps.isBot, alive: !!ps.alive, left: !!ps.left,
      lp: ps.lp, funds: ps.funds, shopLevel: ps.shop ? ps.shop.level : 0,
      board: ps.board ? ps.board.size : 0,
      layers,
    });
  }
  return {
    round: m.round, phase: m.phase,
    phaseName: PHASE_NAMES[m.phase] || m.phase,
    // what the NEXT round will be (the target when a jump is queued, else the engine's own next number)
    nextRound: Number.isInteger(devState.targetRound) ? devState.targetRound : m.round + 1,
    targetRound: devState.targetRound,
    roundCtl: roundControlState(),
    endless: !!m.endless, endlessRound: m.endlessRound || 0,
    maxShopLevel: m.gd ? m.gd.maxShopLevel : 0,
    lastRound: m.gd ? m.gd.lastRound : 0,
    hiddenRound: m.gd && m.gd.hiddenRound ? m.gd.hiddenRound : null,
    enemyScale: m.gd ? m.gd.enemyScale(m.round) : null,
    players,
  };
}

// ---------------------------------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------------------------------

export function loadOverrides(file = OVERRIDES_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of ['lobby', 'match', 'me', 'patch']) if (isPlain(j[k])) ov[k] = j[k];
    _lobbySig = lobbySig();
    return true;
  } catch { return false; }
}

let saveTimer = null;
export function saveOverrides(file = OVERRIDES_FILE) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(file, JSON.stringify(ov, null, 2), 'utf8'); } catch (e) { warn('save', e); }
  }, 120);
}

export const devRoot = ROOT;

// ---------------------------------------------------------------------------------------------------
// 自检：拿真实的 GameData 解析一遍覆盖后的数值
// ---------------------------------------------------------------------------------------------------

/**
 * 用真实的 GameData 造一个实例、套上覆盖，返回面板看得懂的「解析结果」。
 * 这是「改的数值到底进了游戏没有」的证明：它走的是游戏自己的 getter，不是覆盖表。
 * @param {string} [modeId]
 * @param {number} [round]
 */
export function probe(modeId = 'mode_single_hard', round = 1) {
  const GD = live.GameData;
  if (!GD) return { ok: false, error: 'GameData 未注册（installMethodPatches 没跑？）' };
  const { getData } = live.dataMod || {};
  let gd;
  try { gd = new GD(getData ? getData() : undefined, modeId); } catch (e) { return { ok: false, error: `构造 GameData 失败: ${e.message}` }; }
  applyLobbyTo(gd);
  const r = Math.max(1, Math.trunc(round) || 1);
  let scale = null;
  try { scale = gd.enemyScale(r); } catch (e) { scale = { error: e.message }; }
  return {
    ok: true,
    modeId,
    round: r,
    resolved: {
      startLp: gd.defaultStartLp,
      startLpOfBand: (() => { try { return gd.startLp(gd.defaultBandId); } catch { return null; } })(),
      maxShopLevel: gd.maxShopLevel,
      refreshPrice: gd.refreshPrice,
      benchSize: gd.benchSize,
      deployCap: gd.deployCap,
      equipPerChess: gd.equipPerChess,
      incomeCap: gd.incomeCap,
      incomeAtRound: (() => { try { return gd.income(r); } catch { return null; } })(),
      upgradePrices: (() => { try { return gd.upgradePrices(); } catch { return null; } })(),
      upgradeBase1: (() => { try { return gd.upgradeBase(1); } catch { return null; } })(),
      lastRound: gd.lastRound,
      hiddenRound: gd.hiddenRound,
      endlessEliteRounds: gd.endlessCfg.eliteRounds,
      endlessGrowth: gd.endlessCfg.growth,
      endlessBalance: gd.endlessCfg.balance,
      endlessDraft: gd.endlessCfg.draft,
      // the endless special items as the game resolves them (name / price / gate), including the mirrored
      // data/items.json copy the client uses for the shop card and the info popup
      endlessItems: (() => {
        const out = [];
        try {
          const live = gd.endlessActive;
          gd.setEndlessActive(true);
          // data/items.json (what the CLIENT reads for the shop card + info popup) is mirrored from these specs by
          // tools/sync-endless-items.mjs; report per item whether that mirror is present
          const clientItems = (gd.raw && gd.raw.items) || {};
          for (const rec of gd.endlessShopItems()) {
            out.push({
              id: rec.id, name: rec.name, icon: rec.iconEmoji, tier: rec.tier,
              price: gd.itemPrice(rec.id), desc: rec.desc,
              deployCapAtLeast: rec.deployCapAtLeast, requiresDeployCap: rec.requiresDeployCap,
              mods: rec.mods,
              inClientData: !!clientItems[rec.id],
            });
          }
          gd.setEndlessActive(live);
        } catch { /* ignore */ }
        return out;
      })(),
      // 机变阶段 in the loop: the endless rounds that open with one (round 16 + the loop's first 30 waves)
      endlessDraftRounds: (() => {
        const out = [];
        try {
          const first = gd.endlessFirstRound();
          gd.setEndlessActive(true);
          for (let w = 1; w <= 30; w++) if (gd.isEndlessDraftRound(first + w - 1)) out.push(first + w - 1);
          gd.setEndlessActive(false);
        } catch { /* the config may not support it */ }
        return out;
      })(),
      enemyScale: scale,
    },
  };
}

