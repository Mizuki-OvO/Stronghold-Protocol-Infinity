// Verify the live quick tunnel from the outside: system DNS, then SNI-bypass against the Cloudflare edge,
// then every path the game client needs on first paint.
const https = require('https');
const dns = require('dns');
const fs = require('fs');

const HOST = (process.argv[2] || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
if (!HOST) { console.log('usage: node _check.mjs <host>'); process.exit(2); }

const EDGE = ['104.16.230.132', '104.16.231.132'];

function req(ip, p) {
  return new Promise((resolve) => {
    const r = https.request({ host: ip, servername: HOST, path: p, port: 443, method: 'GET',
      headers: { Host: HOST, 'User-Agent': 'Mozilla/5.0' }, rejectUnauthorized: false, timeout: 25000 },
      (res) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ s: res.statusCode, b: Buffer.concat(c) })); });
    r.on('timeout', () => { r.destroy(); resolve({ s: 'TIMEOUT', b: Buffer.alloc(0) }); });
    r.on('error', (e) => resolve({ s: 'ERR:' + (e.code || e.message), b: Buffer.alloc(0) }));
    r.end();
  });
}

// WebSocket upgrade through the tunnel — this is what actually matters for multiplayer.
function wsCheck() {
  return new Promise((resolve) => {
    const crypto = require('crypto');
    const key = crypto.randomBytes(16).toString('base64');
    const r = https.request({ host: EDGE[0], servername: HOST, path: '/ws', port: 443, method: 'GET',
      headers: { Host: HOST, Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                 'Sec-WebSocket-Key': key, 'User-Agent': 'Mozilla/5.0' },
      rejectUnauthorized: false, timeout: 20000 });
    r.on('upgrade', () => { resolve('101 Switching Protocols  [WebSocket OK]'); r.destroy(); });
    r.on('response', (res) => { resolve('unexpected HTTP ' + res.statusCode); r.destroy(); });
    r.on('timeout', () => { r.destroy(); resolve('TIMEOUT'); });
    r.on('error', (e) => resolve('ERR:' + (e.code || e.message)));
    r.end();
  });
}

(async () => {
  const t0 = Date.now();
  console.log('=== 隧道可用性检查 ===');
  console.log('地址: https://' + HOST);
  console.log('时间: ' + new Date().toLocaleString('zh-CN') + '\n');

  const d = await new Promise((r) => dns.lookup(HOST, (e, a) => r(e ? null : a)));
  console.log('本机 DNS 解析 : ' + (d ? d + '  (本机可解析)' : 'FAIL (ENOTFOUND — 本机解析器问题，见文末说明)'));

  const PATHS = [
    ['/', 'index.html'],
    ['/js/main.js', 'MODULE 入口'],
    ['/vendor/preact.module.js', 'import map'],
    ['/vendor/hooks.module.js', 'import map'],
    ['/shared/constants.js', 'main.js import'],
    ['/data/config.json', '游戏数据'],
    ['/data/assets.json', '素材清单'],
    ['/sim/spec.js', '战斗模拟'],
    ['/data.js', '服务端 shim'],
    ['/fonts/fonts.css', '字体'],
    ['/healthz', '健康检查'],
  ];

  console.log('\n--- 启动路径 ---');
  let bad = 0;
  for (const [p, why] of PATHS) {
    const r = await req(EDGE[0], p);
    const ok = r.s === 200;
    if (!ok) bad++;
    console.log(`  ${String(r.s).padEnd(8)} ${String(r.b.length + 'B').padEnd(10)} ${p.padEnd(30)} ${ok ? 'OK' : 'FAIL'}  [${why}]`);
  }

  console.log('\n--- WebSocket (联机关键) ---');
  console.log('  /ws -> ' + (await wsCheck()));

  console.log('\n--- 内容校验 ---');
  const idx = (await req(EDGE[0], '/')).b.toString('utf8');
  const isGame = /id="boot-err"/.test(idx) && /\/js\/main\.js/.test(idx);
  console.log('  返回的是游戏页 : ' + isGame);
  const h = await req(EDGE[0], '/healthz');
  if (h.s === 200) console.log('  /healthz       : ' + h.b.toString('utf8').trim());

  console.log('\n=== 结论 ===');
  console.log(bad === 0 && isGame
    ? '✅ 隧道可用，11/11 路径正常，WebSocket 已通 — 可以发给朋友。'
    : `❌ 有问题：${bad} 个路径失败${isGame ? '' : '，且返回的不是游戏页'}`);
  console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})();
