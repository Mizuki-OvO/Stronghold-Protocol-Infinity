// dev-launch.mjs — 起「带数值修改器的本地服」(dev only)。
//
//   node dev-launch.mjs [--port 3100] [--panel 3101] [--no-open]
//
// 两件事：
//   * 在 startServer 之前给 GameData / PlayerState / Match 打上方法级补丁（dev-bridge）
//   * 游戏服之外再起一个面板服（dev-server，端口 3101）
//
// 项目和 data/*.json 一个字节都不改；全部覆盖都是进程内的，写在 dev-overrides.json 里。
import fs from 'node:fs';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(optOf('--port', process.env.PORT || 3100));
const PANEL_PORT = Number(optOf('--panel', process.env.DEV_PANEL_PORT || 3101));
const OPEN = !argv.includes('--no-open');

const B = await import('./dev-bridge.mjs');

// 基础值（面板显示用）+ 上次的覆盖
B.loadBaseConfig();
const hadSaved = B.loadOverrides();
if (hadSaved) console.log('[dev] 已载入 dev-overrides.json');

// 打补丁（必须在任何对局被创建之前）
const { Match } = await import('./server/match/Match.js');
const { GameData, endlessItemRecord } = await import('./server/match/gamedata.js');
const { PlayerState } = await import('./server/match/PlayerState.js');
const dataMod = await import('./server/data.js');
const { startServer } = await import('./server/index.js');
const { startPanel } = await import('./dev-server.mjs');

B.installMethodPatches({ GameData, PlayerState, Match, dataMod, endlessItemRecord });
B.onApply(() => { try { B.applyMatch(null, 'live'); } catch { /* 还没有对局 */ } });

// 起服务。把真正的 Match 显式交进去：index.js 传的是 `MatchClass: opts.MatchClass`（undefined），
// 会盖掉 lobby.js 的解构默认值，于是实际跑的是 StubMatch 空壳 —— 面板要跟真实对局就得自己交。
const MatchClass = B.makeTrackedMatchClass(Match);
const srv = await startServer({ port: PORT, host: '0.0.0.0', quiet: false, MatchClass });
B.setLive({ server: srv });
await startPanel(PANEL_PORT, '0.0.0.0');

const lan = Object.values(os.networkInterfaces()).flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);

console.log('');
console.log('='.repeat(72));
console.log('  卫戍协议 · 本地服 + 数值修改器');
console.log('='.repeat(72));
console.log(`  游戏        : http://localhost:${PORT}`);
console.log(`  修改器面板  : http://localhost:${PANEL_PORT}`);
if (lan.length) console.log(`  局域网面板  : ${lan.map((ip) => `http://${ip}:${PANEL_PORT}`).join('  ')}`);
console.log('');
console.log('  用法        : 先开面板 → 「无尽测试档」→ 再进游戏创建房间开局');
console.log('  对局中途改  : 面板玩家卡片里改生命/金币/商店/羁绊 → 点「仅此人」/「所有人」立刻生效');
console.log(`  覆盖文件    : ${path.join(ROOT, 'dev-overrides.json')}`);
console.log('='.repeat(72));
console.log('');

if (OPEN) {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  const exe = candidates.find((c) => c && existsSync(c));
  if (exe) {
    try {
      spawn(exe, [`http://localhost:${PANEL_PORT}/`], { detached: true, stdio: 'ignore' }).unref();
      console.log(`  已打开面板（${exe.includes('msedge') ? 'Edge' : 'Chrome'}）：http://localhost:${PANEL_PORT}/`);
    } catch (e) { console.log(`  (浏览器打开失败: ${e.message} — 手动访问 http://localhost:${PANEL_PORT}/)`); }
  } else {
    console.log(`  (没找到浏览器，手动访问 http://localhost:${PANEL_PORT}/)`);
  }
}

// 退出时落盘
let closing = false;
const bye = () => {
  if (closing) return;
  closing = true;
  try { fs.writeFileSync(B.OVERRIDES_FILE, JSON.stringify(B.ov, null, 2), 'utf8'); } catch { /* ignore */ }
  console.log('\n  [dev] 覆盖已保存到 dev-overrides.json，退出。');
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
