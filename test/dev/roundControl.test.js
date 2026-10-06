// 数值修改器的「回合控制」(dev-bridge): 跳到指定回合 / 跳过当前阶段.
//
// 语义（面板上的说明和这里必须一致）:
//   * 跳回合 = 「从下一个回合起，回合号变成 r」—— 在 `Match.startRound` 的入口一次性接管，不是去改正在跑的那一回合
//     （改了会让已经生成的出怪、结算里的回合号、联机同步互相打架）
//   * 跳到无尽回合会自动把无尽循环打开，否则那一波会用官方 R14 的倍率，等于白跳
//   * 跳阶段 = 立刻执行这个阶段的倒计时到期回调，不是把时钟清零
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { PlayerState } from '../../server/match/PlayerState.js';
import { Match } from '../../server/match/Match.js';
import { makeMatch } from '../match/harness.js';
import * as B from '../../dev-bridge.mjs';

/** A started solo match with the dev patches installed and registered as the live match. */
function devMatch({ seed = 21, difficulty = 'ABYSS' } = {}) {
  B.loadBaseConfig();
  B.installMethodPatches({ GameData, PlayerState, Match });
  const h = makeMatch({ mode: 'solo', difficulty, humans: 1, bots: 0, seed });
  h.start();
  const m = h.m;
  B.setLive({ match: m, gd: m.gd });
  B.clearTargetRound();
  return { h, m };
}

/** Drive to `round`, topping the seat up so it is never eliminated mid-drive. */
function driveTo(h, m, round, maxSteps = 3e7) {
  return h.drive(() => {
    for (const ps of m.alivePlayers()) ps.lp = Math.max(ps.lp, 9999);
    return m.round === round;
  }, { maxSteps });
}

// ---------------------------------------------------------------------------------------------------
// 1. 排队语义
// ---------------------------------------------------------------------------------------------------

test('a queued round applies at the NEXT round boundary, exactly once', () => {
  const { h, m } = devMatch();
  const view = () => B.matchView();

  // nothing queued: the panel advertises the engine's own next round
  assert.equal(view().targetRound, null);
  assert.equal(view().nextRound, 1, 'from R0 (INFO_CHECK) the next round is R1');

  const res = B.setTargetRound(16);
  assert.equal(res.ok, true);
  assert.equal(res.target, 16);
  assert.equal(view().targetRound, 16, 'queued');
  assert.equal(view().nextRound, 16, 'and the panel shows it as the next round');
  assert.equal(m.round, 0, 'the round in progress is untouched — the queue only affects the NEXT one');

  // …and the next round really is R16
  assert.ok(driveTo(h, m, 16), `reached R16 (got R${m.round} ${m.phase})`);
  assert.equal(B.targetRound(), null, 'the queue is consumed (one-shot)');
  assert.equal(view().nextRound, 17, 'and the panel goes back to natural progression');
  m.dispose();
});

test('a queued round does NOT hijack the round that is already running', () => {
  const { h, m } = devMatch();
  // reach a real PREP of R1 first, then queue a jump and confirm R1 still plays out as R1
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false, maxSteps: 4e6 }));
  B.setTargetRound(16);
  assert.equal(m.round, 1, 'still R1');
  // the round's own wave was built for R1 and must not be rebuilt
  const wave = m.wave;
  assert.ok(wave, 'R1 has its wave');
  // skipping the prep walks R1 → COMBAT (still R1), i.e. the queued 16 waits for the boundary
  const skip = B.skipPhase();
  assert.equal(skip.ok, true, `skipPhase ok: ${JSON.stringify(skip)}`);
  assert.equal(m.round, 1, 'R1 is still the round in progress after skipping its prep');
  assert.equal(m.wave, wave, 'and its wave object is the same one');
  assert.equal(B.targetRound(), 16, 'the queue is still waiting');
  m.dispose();
});

test('the jump recomputes everything that depends on the round number', () => {
  const { h, m } = devMatch();
  assert.ok(driveTo(h, m, 2), 'reached R2');
  const before = m.gd.enemyScale(2);

  B.setTargetRound(30);
  assert.ok(driveTo(h, m, 30), `reached R30 (got R${m.round} ${m.phase})`);
  const after = m.gd.enemyScale(30);

  // R30 is endless wave 15 → the compounding really ran on the new number. The base is the official R14 table
  // (endless rounds compound the LAST official round), so the expected value is base × growth^step.
  const base = m.gd.baseEnemyScale(m.gd.lastRound);
  const step = m.gd.endlessStep(30);
  assert.equal(step, 15, 'endless step of R30');
  const growth = m.gd.endlessCfg.growth;
  assert.equal(Math.round(after.hpMul * 1000), Math.round(base.hpMul * Math.pow(growth.hp, step) * 1000),
    `hp = R${m.gd.lastRound} base × ${growth.hp}^${step}`);
  assert.equal(Math.round(after.defMul * 1000), Math.round(Math.pow(growth.def, step) * 1000),
    'and the defence column the official table lacks');
  assert.ok(after.hpMul > before.hpMul, `and it is clearly harder than R2 (${before.hpMul} → ${after.hpMul})`);
  assert.equal(m.gd.endlessCyclePos(30), 0, 'R30 starts a fresh endless cycle');
  m.dispose();
});

test('jumping into an endless round switches the loop on (otherwise the wave would use the official R14 stats)', () => {
  const { h, m } = devMatch();
  assert.equal(m.gd.endlessActive, false, 'a fresh match is not in the loop');
  assert.equal(m.gd.isEndlessRound(30), false);

  B.setTargetRound(30);
  assert.ok(driveTo(h, m, 30), 'reached R30');
  assert.equal(m.gd.endlessActive, true, 'the loop is live now');
  assert.equal(m.endless, true, 'and the match knows it');
  assert.equal(m.gd.isEndlessRound(30), true);
  // the loop's rules are real: compounding + the endless shop level
  assert.equal(m.gd.enemyScale(30).endless, 15, 'compounding ran');
  assert.equal(m.gd.maxShopLevel, 7, 'the endless shop is open');
  assert.equal(m.gd.isEndlessAvailable(), true);
  m.dispose();
});

test('jumping backwards lowers the difficulty again (the round number is the single source of truth)', () => {
  const { h, m } = devMatch();
  B.setTargetRound(30);
  assert.ok(driveTo(h, m, 30), 'reached R30');
  const hard = m.gd.enemyScale(30).hpMul;

  B.setTargetRound(14);
  assert.ok(driveTo(h, m, 14), `reached R14 (got R${m.round} ${m.phase})`);
  const easy = m.gd.enemyScale(14).hpMul;
  assert.ok(easy < hard, `R14 is easier than R30 (${easy} < ${hard})`);
  assert.equal(m.gd.endlessStep(14), 0, 'R14 is an official round, not an endless wave');
  // the loop stays armed (it was already live) — the player is simply back on an official round
  assert.equal(m.gd.endlessActive, true, 'endless stays armed; R16+ is still the loop');
  m.dispose();
});

test('round argument validation rejects nonsense', () => {
  const { m } = devMatch();
  for (const bad of [0, -3, 1e9, 'abc', '', null, undefined, NaN, Infinity, -Infinity, {}, []]) {
    const r = B.setTargetRound(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad) ?? String(bad)} is refused`);
    assert.ok(r.error, 'with a reason');
  }
  assert.equal(B.targetRound(), null, 'nothing was queued by the refusals');
  // a non-integer number is truncated (the panel only ever sends integers) — so 2.9 is a real request for round 2
  const frac = B.setTargetRound(2.9);
  assert.equal(frac.ok, true);
  assert.equal(frac.target, 2, '2.9 is read as round 2 (Math.trunc)');
  B.clearTargetRound();
  // the current round is accepted but is a no-op (no queue needed). Use a round the match is really on when the test
  // ran at R0 (INFO_CHECK): queueing R1 is a real request there, so assert the semantics for both cases.
  const cur = m.round;
  const same = B.setTargetRound(cur > 0 ? cur : 1);
  assert.equal(same.ok, true);
  if (cur > 0) assert.equal(B.targetRound(), null, 'queuing the round you are on queues nothing');
  else assert.equal(B.targetRound(), 1, 'from R0, queueing R1 is a normal (forward) request');
  B.clearTargetRound();
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 2. 跳过阶段
// ---------------------------------------------------------------------------------------------------

test('skip fires the phase deadline early instead of zeroing the clock', () => {
  const { h, m } = devMatch();
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false, maxSteps: 4e6 }));
  const st = B.roundControlState();
  assert.equal(st.canJump, true, 'PREP can be skipped');
  assert.equal(st.canSkipPhase, true, 'and it has a countdown to fire');
  assert.equal(st.phase, PHASE.PREP);

  const res = B.skipPhase();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.from.phase, PHASE.PREP);
  assert.equal(res.from.round, 1);
  assert.notEqual(m.phase, PHASE.PREP, `the prep ended (now ${m.phase})`);
  assert.equal(res.to.round, 1, 'and it is still round 1 — skipping a phase is not a round jump');
  m.dispose();
});

test('an untimed phase reports "no countdown" instead of pretending to skip', () => {
  const { h, m } = devMatch();
  // a solo match's own 机变 / untimed prep publishes no deadline; simulate by clearing what setDeadline recorded
  assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: false, maxSteps: 4e6 }));
  // ready up: the match moves on by itself, so the phase is no longer skippable by a timer
  const ps = h.ps('p_0');
  m.handle(ps.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP, { maxSteps: 2e6 });
  const st = B.roundControlState();
  if (!st.canJump) {
    assert.ok(st.reason, 'a blocked phase explains itself');
  } else {
    assert.equal(st.canSkipPhase, false, 'COMBAT/leader fights have no deadline to fire');
    const res = B.skipPhase();
    assert.equal(res.ok, false, 'and skipping is refused with a reason');
    assert.ok(res.error, 'the reason is human-readable');
  }
  m.dispose();
});

test('the control state degrades gracefully with no match at all', () => {
  const saved = B.currentMatch();
  B.setLive({ match: null });
  const st = B.roundControlState();
  assert.equal(st.canJump, false);
  assert.equal(st.reason, '还没有对局');
  assert.equal(B.setTargetRound(5).ok, false);
  assert.equal(B.skipPhase().ok, false);
  B.setLive({ match: saved });
});

// ---------------------------------------------------------------------------------------------------
// 3. 组合：跳回合 + 跳过阶段 是快速推进对局的两个正交手段
// ---------------------------------------------------------------------------------------------------

test('skip + jump walk a match forward without breaking the invariants', () => {
  const { h, m } = devMatch();
  B.setTargetRound(19);                       // 19 = endless wave 4 = the cycle's 机变 round
  assert.ok(driveTo(h, m, 19), `reached R19 (got R${m.round} ${m.phase})`);
  assert.equal(m.gd.isEndlessRound(19), true);
  assert.equal(m.gd.isEndlessDraftRound(19), true, 'R19 is the loop’s 机变 round');
  // skipping through it must not corrupt the phase machine
  for (let i = 0; i < 3; i++) {
    const st = B.roundControlState();
    if (!st.canJump) break;
    B.skipPhase();
  }
  assert.ok([PHASE.SP_DRAFT, PHASE.PREP, PHASE.ROUND_START, PHASE.BATTLE_CHECK, PHASE.COMBAT].includes(m.phase),
    `still in a sane phase (${m.phase})`);
  assert.equal(m.round, 19, 'still round 19');
  h.invariants();
  m.dispose();
});
