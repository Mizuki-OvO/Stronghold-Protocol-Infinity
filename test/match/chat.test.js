// 打字聊天 (typed chat, Infinity fork): the co-op chat — who may speak, what the server rewrites, the rate limit and
// the backlog a (re)joining socket gets. The official mode ships only the 36 canned emotes; this is a remake feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_MAX_LEN, CHAT_COOLDOWN_MS, CHAT_LOG_MAX, CHAT_BURST } from '../../shared/constants.js';
import { C2S, S2C } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';

/** A started co-op match with the broadcast traffic cleared. */
function coopMatch() {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 5 });
  h.start();
  h.bc.length = 0;
  h.sent.length = 0;
  return h;
}
const chats = (h) => h.bc.filter((m) => m.t === 'm.chat');

// ---------------------------------------------------------------------------------------------------
// 1. 协议与广播
// ---------------------------------------------------------------------------------------------------

test('the wire protocol declares g.chat / m.chat / m.chatLog', () => {
  assert.ok(C2S['g.chat'], 'C2S g.chat exists');
  assert.equal(C2S['g.chat'].text('你好'), true);
  assert.equal(C2S['g.chat'].text(''), false, 'an empty string is refused by the validator');
  assert.equal(C2S['g.chat'].text(123), false, 'a non-string is refused');
  assert.ok(S2C.includes('m.chat'), 'S2C m.chat');
  assert.ok(S2C.includes('m.chatLog'), 'S2C m.chatLog');
});

test('a line is broadcast to every seat, the sender included', () => {
  const h = coopMatch();
  const res = h.m.handle('p_0', { t: 'g.chat', text: '你好' });
  assert.deepEqual(res, { ok: true });
  const got = chats(h);
  assert.equal(got.length, 1, 'one broadcast');
  assert.equal(got[0].playerId, 'p_0');
  assert.equal(got[0].name, 'P0');
  assert.equal(got[0].text, '你好');
  assert.ok(Number.isFinite(got[0].at), 'carries a server timestamp');
  // a broadcast reaches everyone, so the sender's own client renders it too (m.chat is not unicast)
  assert.equal(typeof h.m.broadcast, 'function');
  h.m.dispose();
});

test('the sender is taken from the server session, so a client cannot speak as somebody else', () => {
  const h = coopMatch();
  h.m.handle('p_1', { t: 'g.chat', text: '我是房主', playerId: 'p_0', name: 'P0' });
  const line = chats(h)[0];
  assert.equal(line.playerId, 'p_1', 'the real sender');
  assert.equal(line.name, 'P1', 'the real name');
  h.m.dispose();
});

test('text is trimmed, whitespace-collapsed, control-stripped and capped', () => {
  const h = coopMatch();
  h.m.handle('p_0', { t: 'g.chat', text: '  你好   世界  ' });
  assert.equal(chats(h)[0].text, '你好 世界', 'outer trim + inner run collapse');
  h.bc.length = 0;
  h.m.handle('p_0', { t: 'g.chat', text: 'a\nb\tc\u0000d' });
  assert.equal(chats(h)[0].text, 'a b c d', 'newlines / tabs / NUL become single spaces');
  h.bc.length = 0;
  h.m.handle('p_0', { t: 'g.chat', text: '啊'.repeat(400) });
  assert.equal(chats(h)[0].text.length, CHAT_MAX_LEN, `capped at ${CHAT_MAX_LEN}`);
  h.m.dispose();
});

test('an empty or whitespace-only line is refused', () => {
  const h = coopMatch();
  for (const bad of ['', '   ', '\n\t', '\u0000']) {
    const r = h.m.handle('p_0', { t: 'g.chat', text: bad });
    assert.ok(r.error, `${JSON.stringify(bad)} is refused`);
  }
  assert.equal(chats(h).length, 0, 'nothing was broadcast');
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 2. 谁能说话
// ---------------------------------------------------------------------------------------------------

test('a solo match has no chat (the server refuses it)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 6 });
  h.start();
  const r = h.m.handle('p_0', { t: 'g.chat', text: '有人吗' });
  assert.equal(r.error, 'WRONG_PHASE');
  assert.match(r.detail || '', /solo/);
  h.m.dispose();
});

test('a spectator receives the chat but cannot speak', () => {
  const h = coopMatch();
  h.m.addSpectator('spec_1');
  h.m.handle('p_0', { t: 'g.chat', text: '观战的朋友看得到' });
  assert.equal(chats(h).length, 1, 'the line was broadcast (spectators ride the same broadcast)');
  // a spectator is not a player: Match.handle resolves the seat first and refuses the rest
  const r = h.m.handle('spec_1', { t: 'g.chat', text: '我也说一句' });
  assert.ok(r.error, 'a spectator cannot send');
  assert.equal(chats(h).length, 1, 'and nothing extra went out');
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 3. 限流
// ---------------------------------------------------------------------------------------------------

test('a short burst is allowed, then the cooldown bites', () => {
  const h = coopMatch();
  let ok = 0; let rate = 0;
  // NO time advances in this loop, so every send but the first lands inside the cooldown window
  for (let i = 0; i < CHAT_BURST + 5; i++) {
    const r = h.m.handle('p_0', { t: 'g.chat', text: `第 ${i} 条` });
    if (r.ok) ok++; else if (r.error === 'RATE') rate++; else assert.fail(`unexpected ${JSON.stringify(r)}`);
  }
  assert.equal(ok, CHAT_BURST + 1, `the first line plus a burst of ${CHAT_BURST} go through`);
  assert.equal(rate, 4, 'the rest are rate-limited');
  // and a different seat is not affected by it
  assert.deepEqual(h.m.handle('p_1', { t: 'g.chat', text: '我不受影响' }), { ok: true });
  h.m.dispose();
});

test('the cooldown is per sender and time-based', () => {
  const h = coopMatch();
  for (let i = 0; i < CHAT_BURST + 1; i++) h.m.handle('p_0', { t: 'g.chat', text: 'x' });
  assert.ok(h.m.handle('p_0', { t: 'g.chat', text: 'x' }).error, 'blocked while inside the cooldown');
  // advance virtual time past the cooldown: the burst refills
  h.sched.advance(CHAT_COOLDOWN_MS + 50);
  assert.deepEqual(h.m.handle('p_0', { t: 'g.chat', text: 'x' }), { ok: true }, 'allowed again after the cooldown');
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 4. 历史（重连 / 中途加入的观战者）
// ---------------------------------------------------------------------------------------------------

test('the backlog is bounded, ordered and handed to a resyncing seat', () => {
  const h = coopMatch();
  for (let i = 0; i < CHAT_LOG_MAX + 12; i++) {
    h.sched.advance(CHAT_COOLDOWN_MS + 10);       // step past the rate limit each time
    h.m.handle('p_0', { t: 'g.chat', text: `第 ${i} 条` });
  }
  assert.equal(h.m._chatLog.length, CHAT_LOG_MAX, `bounded at ${CHAT_LOG_MAX}`);
  const log = h.m.chatBacklog();
  assert.equal(log.t, 'm.chatLog');
  assert.equal(log.lines.length, CHAT_LOG_MAX);
  assert.equal(log.lines[log.lines.length - 1].text, `第 ${CHAT_LOG_MAX + 11} 条`, 'newest last');
  assert.ok(!log.lines.some((l) => l.text === '第 0 条'), 'the oldest fell off');

  // a reconnect / a spectator mid-match gets it through _resync
  h.sent.length = 0;
  h.m.onReconnect('p_1');
  const pushed = h.sent.filter(([id, m]) => id === 'p_1' && m.t === 'm.chatLog');
  assert.equal(pushed.length, 1, 'exactly one backlog frame, to that seat only');
  assert.equal(pushed[0][1].lines.length, CHAT_LOG_MAX);

  h.sent.length = 0;
  h.m.addSpectator('spec_2');
  const spec = h.sent.filter(([id, m]) => id === 'spec_2' && m.t === 'm.chatLog');
  assert.equal(spec.length, 1, 'a spectator who joins mid-match gets it too');
  h.m.dispose();
});

test('an empty log sends no frame at all', () => {
  const h = coopMatch();
  h.sent.length = 0;
  h.m.onReconnect('p_1');
  assert.equal(h.sent.filter(([, m]) => m.t === 'm.chatLog').length, 0, 'nothing to hand over');
  h.m.dispose();
});
