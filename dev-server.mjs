// dev-server.mjs — 本地「数值修改器」面板服务 (dev only)。
//
// 独立进程，端口 3101：面板页面 + 一组 JSON 接口。游戏的修值能力全部来自 dev-bridge.mjs（同一个进程）。
// 面板只是个 HTTP 壳，不碰游戏对象 —— 它改的是覆盖表，bridge 负责把覆盖表插到游戏的读取点上。
//
//   GET  /                    面板页面
//   GET  /dev/api/state       基础值 + 当前覆盖 + 当前对局
//   POST /dev/api/set         { scope, path|playerId, value | values }
//   POST /dev/api/clear       { scope, path|playerId, all }
//   POST /dev/api/apply       立刻把覆盖套到当前对局
//   POST /dev/api/bonds       { playerId, layer } 一键把全部羁绊设成某层数（含 0 = 清空）
//   POST /dev/api/preset      { name }
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from './dev-bridge.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(ROOT, 'dev-panel.html');

const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);

/** 智能取值："999" → 999，"true" → true，"a,b" → ['a','b']，"null" → null，"x" → "x"。 */
function coerce(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (s === '') return '';
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '[]' || s === '{}' || (s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    try { return JSON.parse(s); } catch { /* 当作字符串 */ }
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?)+$/.test(s)) return s.split(',').map(Number);
  return s;
}

function bundle() {
  const view = B.matchView();
  return {
    ok: true,
    ov: B.ov,
    base: B.baseValues(),
    match: view,
    hasMatch: !!view,
    file: B.OVERRIDES_FILE,
  };
}

function write(obj, patch) {
  // 覆盖表是普通对象：只替换顶层键的内容，保持引用（bridge 读的是同一个对象）
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, patch);
  B.markDirty();
  B.saveOverrides();
  try { B.applyMatch(null, 'live'); } catch { /* 没有对局时会跳过 */ }
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ---------------------------------------------------------------------------------------------------
// 预设
// ---------------------------------------------------------------------------------------------------
function applyPreset(name) {
  if (name === '无尽测试档') {
    const next = JSON.parse(JSON.stringify(B.ov));
    next.lobby = { ...next.lobby, 'economy.defaultStartLp': 9999, 'economy.startLp': 9999 };
    next.match = { ...next.match, lp: 9999, funds: 999, shopLevel: 6 };
    next.patch = { ...next.patch, qa: { ...(next.patch.qa || {}), shopLevelCap: 7, freeRefresh: true } };
    write(B.ov, next);
    setAllBonds(999);
    return `已套用「无尽测试档」：起手 9999 血 / 9999 金币 / 商店 6 级(上限 7) / 无限刷新 / 全羁绊 999 层`;
  }
  if (name === '还原') {
    write(B.ov, { lobby: {}, match: {}, me: {}, patch: {} });
    setAllBonds(0);
    return '已还原：覆盖表清空，羁绊层数归零（下一回合起全部恢复官方数值）';
  }
  return null;
}

/** 把当前对局（或指定玩家）的全部羁绊设成 layer 层。layer=0 即清空。 */
function setAllBonds(layer) {
  const m = B.currentMatch();
  const gd = m && m.gd;
  const ids = gd && Array.isArray(gd.bondIds) ? gd.bondIds : (gd ? Object.keys(gd.bonds || {}) : []);
  const next = JSON.parse(JSON.stringify(B.ov));
  next.match = { ...next.match };
  if (layer > 0) {
    const bonds = {};
    for (const id of ids) bonds[id] = layer;
    next.match.bonds = bonds;
    next.match.bondsMode = 'set';
  } else {
    delete next.match.bonds;
    delete next.match.bondsMode;
  }
  write(B.ov, next);
  if (layer <= 0) B.clearPlayerBonds(null);
  return ids.length;
}

// ---------------------------------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------------------------------
const routes = {
  'GET /dev/api/state': async () => bundle(),

  'POST /dev/api/set': async (body) => {
    const scope = String(body.scope || '');
    const next = JSON.parse(JSON.stringify(B.ov));
    if (scope === 'me') {
      const pid = String(body.playerId || '');
      if (!pid) return { ok: false, error: '缺少 playerId' };
      const cur = { ...(next.me[pid] || {}) };
      if (body.values && isPlain(body.values)) Object.assign(cur, body.values);
      for (const [p, v] of Object.entries(body.paths || {})) B.setPath(cur, p, coerce(v));
      if (body.path) B.setPath(cur, body.path, coerce(body.value));
      next.me[pid] = cur;
    } else {
      if (scope === 'patch') {
        const cur = { ...(next.patch.qa || {}) };
        if (body.path) cur[body.path] = coerce(body.value);
        if (isPlain(body.values)) Object.assign(cur, body.values);
        for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === '' || cur[k] === false) delete cur[k];
        next.patch = { ...next.patch, qa: cur };
      } else if (scope === 'match') {
        const cur = { ...next.match };
        if (body.path) B.setPath(cur, body.path, coerce(body.value));
        if (isPlain(body.values)) Object.assign(cur, body.values);
        next.match = cur;
      } else {
        const cur = { ...next.lobby };
        if (body.path) cur[body.path] = coerce(body.value);
        if (isPlain(body.values)) Object.assign(cur, body.values);
        for (const k of Object.keys(cur)) if (cur[k] === null || cur[k] === undefined || cur[k] === '') delete cur[k];
        next.lobby = cur;
      }
    }
    write(B.ov, next);
    return bundle();
  },

  'POST /dev/api/clear': async (body) => {
    const next = JSON.parse(JSON.stringify(B.ov));
    if (body.all) return (write(B.ov, { lobby: {}, match: {}, me: {}, patch: {} }), bundle());
    if (body.scope === 'me') {
      if (body.playerId) delete next.me[body.playerId];
      if (body.path && next.me[body.playerId]) B.delPath(next.me[body.playerId], body.path);
    } else if (body.scope === 'patch') {
      if (body.path) B.delPath(next.patch.qa || {}, body.path);
    } else if (body.scope === 'match') {
      if (body.path) B.delPath(next.match, body.path);
    } else if (body.path) {
      delete next.lobby[body.path];
    }
    write(B.ov, next);
    return bundle();
  },

  'POST /dev/api/apply': async () => {
    const m = B.currentMatch();
    const n = m ? B.applyMatch(m, 'live') : 0;
    return { ...bundle(), applied: n };
  },

  'POST /dev/api/bonds': async (body) => {
    const layer = Math.max(0, Math.min(999, Math.trunc(Number(body.layer) || 0)));
    const n = setAllBonds(layer);
    return { ...bundle(), bondsSet: n, layer };
  },

  'POST /dev/api/preset': async (body) => {
    const msg = applyPreset(String(body.name || ''));
    return { ...bundle(), message: msg || '未知预设' };
  },

  'POST /dev/api/probe': async (body) => ({
    ok: true,
    probe: B.probe(body.modeId || 'mode_single_hard', Number(body.round) || 1),
  }),

  // ---- 回合控制 ----------------------------------------------------------------------------------
  /** Body: { round } or { clear: true }. Queues the round the NEXT round will be. */
  'POST /dev/api/round': async (body) => {
    if (body.clear) {
      B.clearTargetRound();
      return { ...bundle(), message: '已取消跳回合（下一回合回到自然推进）' };
    }
    const res = B.setTargetRound(body.round);
    if (!res.ok) return { ...bundle(), ok: false, error: res.error };
    return { ...bundle(), message: res.note };
  },

  /** Fire the current phase's timeout early (not by zeroing the clock). */
  'POST /dev/api/skip': async () => {
    const res = B.skipPhase();
    if (!res.ok) return { ...bundle(), ok: false, error: res.error };
    const stuck = res.to.phase === res.from.phase && res.to.round === res.from.round;
    return {
      ...bundle(),
      message: `跳过：${res.from.phase} R${res.from.round} → ${res.to.phase} R${res.to.round}${stuck ? '（阶段没变，可能还有别的等待条件）' : ''}`,
    };
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const key = `${req.method} ${url.pathname}`;
  const json = (code, obj) => {
    const s = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(s);
  };
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dev' || url.pathname === '/index.html')) {
      const html = fs.readFileSync(PANEL);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    const fn = routes[key];
    if (!fn) return json(404, { ok: false, error: `no route ${key}` });
    const body = req.method === 'POST' ? await readBody(req) : {};
    return json(200, await fn(body));
  } catch (e) {
    return json(500, { ok: false, error: (e && e.stack) || String(e) });
  }
});

export function startPanel(port = 3101, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

export { server };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.DEV_PANEL_PORT || 3101);
  await startPanel(port);
  console.log(`[dev-panel] http://localhost:${port}/`);
}
