// launcher.mjs — one-click launcher for Stronghold Protocol.
//
// Why Node instead of a .bat: cmd's findstr/errorlevel/quote-nesting made the earlier batch versions
// fail silently (a stale TIME_WAIT socket counted as "listening", and `start ... cmd /c ""a" "b""`
// never ran node at all). Here readiness is a real HTTP request.
//
// Modes:
//   node launcher.mjs                game server + Cloudflare quick tunnel  (prints a public URL)
//   node launcher.mjs --lan          game server only                      (LAN / 樱花frp setups)
//   node launcher.mjs --frp          same as --lan, with 樱花frp instructions
//   node launcher.mjs --port 3001    use another port

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { connect as netConnect } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const NODE = join(ROOT, 'node22', 'node.exe');
const SRV = join(ROOT, 'server', 'index.js');
const CF = join(ROOT, 'cloudflared', 'cloudflared.exe');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const PORT = Number(optOf('--port', '3000'));
const USE_FRP = flag('--frp');
const LAN_ONLY = flag('--lan') || USE_FRP || flag('--no-tunnel');

const line = (s = '') => process.stdout.write(s + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function preflight() {
  const missing = [];
  if (!existsSync(NODE)) missing.push(NODE);
  if (!existsSync(SRV)) missing.push(SRV);
  if (!LAN_ONLY && !existsSync(CF)) missing.push(CF);
  if (missing.length) {
    line('='.repeat(64));
    line('  ERROR - missing files');
    missing.forEach((m) => line('  not found: ' + m));
    line('='.repeat(64));
    return false;
  }
  return true;
}

/** Something already listening on the port? (plain TCP connect, no DNS) */
function portBusy(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const sock = netConnect({ host: '127.0.0.1', port });
    let done = false;
    const fin = (v) => { if (!done) { done = true; try { sock.destroy(); } catch { /* ignore */ } resolve(v); } };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => fin(true));
    sock.on('timeout', () => fin(false));
    sock.on('error', () => fin(false));
  });
}

/** Is our own game server already up? (/healthz carries the app version) */
async function existingGameServer(timeoutMs = 6000) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok && j.app ? j : null;
  } catch { return null; }
}

async function serverUp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await existingGameServer(3000);
    if (h) return h;
    await sleep(500);
  }
  return null;
}

function lanUrls() {
  const out = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

function banner(t) { line('='.repeat(64)); line('  ' + t); line('='.repeat(64)); }

async function main() {
  if (!preflight()) process.exit(1);

  banner('Stronghold Protocol: Alliance  v0.1.3');
  line(`  mode : ${USE_FRP ? 'Online via 樱花frp' : LAN_ONLY ? 'LAN / single player' : 'Online (Cloudflare Tunnel)'}`);
  line(`  root : ${ROOT}`);
  line(`  port : ${PORT}`);
  line();

  // ---- 1) game server (reuse a running one rather than failing with EADDRINUSE) ----
  let srv = null;
  let health = await existingGameServer(1500);

  if (health) {
    line('[1/2] a game server is already running - reusing it.');
  } else if (await portBusy(PORT)) {
    line(`[FAIL] port ${PORT} is held by another program.`);
    line(`       Close it, or start with a different port:  node launcher.mjs --port 3001`);
    process.exit(1);
  } else {
    line('[1/2] starting game server ...');
    srv = spawn(NODE, [SRV], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
    srv.on('exit', (code) => {
      line();
      line(`[server exited] code=${code}`);
      shutdown(code ?? 0);
    });
    health = await serverUp();
  }

  if (!health) {
    line('[FAIL] server did not answer on /healthz within 30s.');
    line('       Check the error printed above by node.');
    if (srv) srv.kill();
    process.exit(1);
  }
  line(`[OK] server is up  (app ${health.app}, build ${health.build})${srv ? '' : '  [reused existing]'}`);
  line();

  const shutdown = (code = 0) => {
    try { srv && srv.kill(); } catch { /* ignore */ }
    setTimeout(() => process.exit(code), 300);
  };
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  // ---- 2a) 樱花frp: the tunnel lives in their launcher, so we just hand over ----
  if (USE_FRP) {
    banner('现在就绪 —— 去樱花frp启动器启动隧道');
    line();
    line('  隧道必须指向本机的这个端口：');
    line();
    line(`      本地地址 : 127.0.0.1`);
    line(`      本地端口 : ${PORT}`);
    line(`      隧道类型 : TCP`);
    line();
    line('  ⚠️ 类型必须是 TCP（端口直通），不要用「网站」类型：');
    line('     游戏客户端用的是 /data/ /vendor/ /sim/ /ws 这些根路径，');
    line('     挂在子路径下会直接报「游戏脚本加载失败」。');
    line();
    line('  ⚠️ 明文 HTTP 会被樱花frp 拦（返回 501），需要在隧道上开');
    line('     「自动 HTTPS」，然后用 https:// 访问。');
    line();
    line('  启动隧道后，把启动器显示的地址加 https:// 前缀发给朋友。');
    line();
    line('  本机地址（朋友在同一 WiFi 时可用，无需隧道）：');
    for (const u of lanUrls()) line('    ' + u);
    banner('');
    if (!srv) line('  (server was already running - this window will not stop it)');
    line('  按 Ctrl+C 停止游戏服务器。');
    return;
  }

  // ---- 2b) LAN only ----
  if (LAN_ONLY) {
    banner('READY (LAN mode) - open http://localhost:' + PORT);
    line('  LAN addresses (same Wi-Fi, no tunnel needed):');
    for (const u of lanUrls()) line('    ' + u);
    line();
    line('  Press Ctrl+C to stop.');
    return;
  }

  // ---- 2c) Cloudflare quick tunnel ----
  line('[2/2] opening Cloudflare tunnel ...');
  line('      --edge-ip-version 4 --protocol http2  (IPv6/QUIC is blocked on many CN networks)');
  line();

  let cf = null;
  let url = null;

  for (let attempt = 1; attempt <= 5 && !url; attempt++) {
    line(`  [attempt ${attempt}/5] connecting ...`);
    cf = spawn(CF, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--edge-ip-version', '4', '--protocol', 'http2'],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    cf.on('error', (e) => line('  cloudflared spawn error: ' + e.message));

    const grab = (buf) => {
      for (const ln of buf.toString().split('\n')) {
        if (!ln.trim()) continue;
        process.stdout.write('    | ' + ln.replace(/\s+$/, '') + '\n');
        // A real quick-tunnel host always has a hyphenated subdomain; error lines quote
        // https://api.trycloudflare.com/tunnel, which must NOT be mistaken for the URL.
        if (/\b(failed|ERR|error)\b/i.test(ln)) continue;
        const m = ln.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/i);
        if (m && !url) url = m[0];
      }
    };
    cf.stdout.on('data', grab);
    cf.stderr.on('data', grab);

    const deadline = Date.now() + 60000;
    while (!url && Date.now() < deadline && cf.exitCode === null) await sleep(500);
    if (!url) {
      line('  attempt failed, retrying ...');
      try { cf.kill(); } catch { /* ignore */ }
      await sleep(3000);
    }
  }

  line();
  if (url) {
    const preloadUrl = url + '/%E8%B5%84%E6%BA%90%E9%A2%84%E5%8A%A0%E8%BD%BD.html';
    const hasPreload = existsSync(join(ROOT, 'public', '资源预加载.html'));

    banner('开服成功 - 把下面地址发给朋友');
    line();
    if (hasPreload) {
      line('  ① 先跑资源预加载（只需一次）');
      line('     ' + preloadUrl);
      line();
      line('  ② 然后进游戏');
      line('     ' + url + '/');
      line();
      line('     （预加载完成后会自动跳转到游戏）');
    } else {
      line('  发给朋友：');
      line('     ' + url + '/');
    }
    line();
    line('  建房后把 4 位同盟密钥一起发出去，朋友才能加入。');
    banner('');

    try {
      writeFileSync(join(ROOT, '联机地址.txt'),
        ['卫戍协议：盟约 - 联机地址', '',
         '① 资源预加载（只需一次）：', preloadUrl, '',
         '② 游戏地址：', url + '/', '',
         '生成时间: ' + new Date().toLocaleString('zh-CN'), ''].join('\n'), 'utf8');
      line('  地址已同时写入: ' + join(ROOT, '联机地址.txt'));
    } catch { /* non-fatal */ }
  } else {
    banner('TUNNEL FAILED after 5 attempts');
    line('  Cloudflare edge unreachable right now. Retry, or use LAN mode:');
    line('    node launcher.mjs --lan');
    line();
    line('  The game server is still running - LAN players can connect.');
  }

  line();
  line('  Press Ctrl+C to stop everything.');
}

main().catch((e) => {
  line('launcher error: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
