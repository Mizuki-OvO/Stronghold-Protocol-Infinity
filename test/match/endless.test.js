// 无尽模式 (endless mode, docs/ENDLESS.md): compounding enemy growth, the 6-elite + 1-boss cycle, the merged boss
// pool, and the vote that gates it.
//
// Design decisions under test (user spec):
//   * growth     : compounding — round N = ROUND-15 stats × 1.05^(N-15) hp / 1.03^(N-15) atk,def
//   * cycle      : `eliteRounds` (6) elite rounds + 1 boss round, repeating
//   * boss pool  : the Final Assault pool AND the Hidden Core pool merged
//   * entry      : after a CLEARED Hidden Core; a majority of the alive seats decides (bots default to yes)
//   * refusal    : the match settles exactly as before
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GameData, roundScale } from '../../server/match/gamedata.js';
import { buildNormalWave, buildBossWave, pickRoundEntry } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { makeMatch, DATA, give } from './harness.js';

const MODES = ['mode_single_abyss', 'mode_single_hard', 'mode_single_normal', 'mode_multi_abyss'];

/**
 * The endless path only engages once the match entered the loop, so every endless helper is gated on
 * gd.setEndlessActive(true) — mirroring Match._beginEndless. Returns a ready gd.
 */
function endlessGd(modeId = 'mode_single_abyss') {
  const gd = new GameData(DATA, modeId);
  gd.setEndlessActive(true);
  return gd;
}

/** A factions array that carries a real schedule (what Match passes to the wave builders). */
function scheduledFactions(gd) {
  const types = DATA.factions && DATA.factions.types ? DATA.factions.types : {};
  const chosen = Object.values(types).filter((t) => t && t.involveRandom).map((t) => t.type).sort().slice(0, 3);
  const max = 15;
  const slots = [];
  for (const t of chosen) for (let i = 0; i < 3 && slots.length < max; i++) slots.push(t);
  while (slots.length < max) slots.push('SPECIAL');
  const rng = createRng(42);
  rng.shuffle(slots);
  const picks = [null];
  for (let r = 1; r <= max; r++) picks.push(pickRoundEntry(gd, rng, slots[r - 1], r));
  const arr = chosen.slice();
  Object.defineProperty(arr, 'schedule', { value: Object.freeze({ typeSlots: slots.slice(), picks }), enumerable: false });
  return arr;
}

// ---------------------------------------------------------------------------------------------------
// 1. the compounding scale
// ---------------------------------------------------------------------------------------------------

test('the loop starts one round after the Hidden Core (round 16), not at the core itself', () => {
  for (const modeId of MODES) {
    const gd = endlessGd(modeId);
    // the Hidden Core is a real round of the match and is NOT part of the loop
    assert.equal(gd.hiddenRound, 15, `${modeId}: the core sits at round 15`);
    assert.equal(gd.lastRound, 14, `${modeId}: the official rounds end at 14`);
    assert.equal(gd.endlessFirstRound(), 16, `${modeId}: the loop opens at 16`);
    assert.equal(gd.isEndlessRound(15), false, `${modeId}: the core is never an endless round`);
    assert.equal(gd.isEndlessRound(16), true, `${modeId}: round 16 is the first endless wave`);
    assert.equal(gd.endlessStep(16), 1, `${modeId}: round 16 is endless wave 1`);
    assert.equal(gd.endlessStep(17), 2, `${modeId}: round 17 is endless wave 2`);
    assert.equal(gd.endlessStep(15), 0, `${modeId}: the core is wave 0 (outside the loop)`);
  }
});

test('endless scale: compounding growth stacked on the LAST official round', () => {
  for (const modeId of MODES) {
    const gd = endlessGd(modeId);
    const last = gd.lastRound;
    const first = gd.endlessFirstRound();
    const base = gd.baseEnemyScale(last);
    const g = gd.endlessCfg.growth;
    // per endless wave: hp / atk / def are MULTIPLIERS, res is FLAT points (the official table has no def or res column)
    assert.deepEqual(g, { hp: 1.1, atk: 1.06, def: 1.06, res: 1 }, `${modeId}: default growth`);

    for (const st of [1, 2, 5, 7, 20, 85]) {
      const r = first + st - 1;                    // endless wave `st`
      const s = gd.enemyScale(r);
      const f = Math.fround;
      assert.equal(s.hpMul, f(base.hpMul * Math.pow(g.hp, st)), `${modeId} R${r} hp`);
      assert.equal(s.atkMul, f(base.atkMul * Math.pow(g.atk, st)), `${modeId} R${r} atk`);
      assert.equal(s.defMul, f(Math.pow(g.def, st)), `${modeId} R${r} def`);
      // res is additive: +g.res POINTS per wave, not a percentage
      assert.equal(s.resFlat, f(g.res * st), `${modeId} R${r} res +${g.res * st}`);
      assert.equal(s.speedMul, base.speedMul, `${modeId} R${r} speed unchanged`);
      assert.equal(s.endless, st, `${modeId} R${r} step`);
    }
  }
});

test('endless growth: the four stats grow by the documented per-wave amounts', () => {
  // The numbers the README / CHANGELOG promise: 生命 +10% / 防御 +6% / 攻击 +6% / 法抗 +1 per wave.
  const gd = endlessGd();
  const g = gd.endlessCfg.growth;
  assert.equal(g.hp, 1.1, '生命每波 +10%');
  assert.equal(g.def, 1.06, '防御每波 +6%');
  assert.equal(g.atk, 1.06, '攻击每波 +6%');
  assert.equal(g.res, 1, '法抗每波 +1');
  // the cumulative shape that used to read as "defence growth does nothing"
  const at = (st) => gd.enemyScale(gd.endlessFirstRound() + st - 1);
  assert.ok(Math.abs(at(6).defMul - Math.pow(1.06, 6)) < 1e-6, '第 6 波防御 ×1.42');
  assert.ok(at(6).defMul > 1.4, 'clearly above the old 1.19');
  assert.equal(at(6).resFlat, 6, '第 6 波法抗 +6');
  // config can switch the resistance growth off entirely
  const off = new GameData(DATA, 'mode_single_abyss');
  off.setEndlessActive(true);
  off.config = { ...off.config, endless: { growth: { hp: 1.05, atk: 1.03, def: 1.03, res: 0 } } };
  assert.equal(off.endlessCfg.growth.res, 0);
  assert.equal(off.enemyScale(off.endlessFirstRound() + 5).resFlat, undefined, 'no resFlat key when growth.res is 0');
});

test('endless scale: official rounds AND the Hidden Core are untouched', () => {
  for (const modeId of MODES) {
    const gd = endlessGd(modeId);
    for (let r = 1; r <= gd.endlessFirstRound() - 1; r++) {
      const a = gd.enemyScale(r);
      assert.deepEqual(a, gd.baseEnemyScale(r), `${modeId} R${r} identical to the official table`);
      assert.equal(a.defMul, undefined, `${modeId} R${r} no defMul before endless`);
      assert.equal(a.endless, undefined, `${modeId} R${r} no endless marker`);
    }
    // the core specifically: it must never carry the loop's multipliers
    if (gd.hiddenRound != null) {
      const core = gd.enemyScale(gd.hiddenRound);
      assert.equal(core.defMul, undefined, `${modeId}: the Hidden Core takes no endless defMul`);
      assert.equal(core.endless, undefined, `${modeId}: the Hidden Core is not an endless wave`);
      assert.deepEqual(core, gd.baseEnemyScale(gd.lastRound), `${modeId}: the core keeps the last official values`);
    }
  }
});

test('roundScale is a pure function of the row it wraps', () => {
  const fake = {
    lastRound: 10,
    _endlessActive: true,
    baseEnemyScale: (r) => ({ hpMul: r, atkMul: r * 2, speedMul: 1 }),
    endlessCfg: { growth: { hp: 1.05, atk: 1.03, def: 1.03 } },
    isEndlessRound(r) { return this._endlessActive === true && r >= this.endlessFirstRound(); },
    endlessFirstRound() { return this.lastRound + 1; },
    endlessStep(r) { return this.isEndlessRound(r) ? r - this.endlessFirstRound() + 1 : 0; },
  };
  assert.deepEqual(roundScale(3, fake), { hpMul: 3, atkMul: 6, speedMul: 1 });
  const s = roundScale(12, fake);          // the second endless wave: step 2
  assert.equal(s.endless, 2);
  assert.equal(s.hpMul, Math.fround(10 * 1.05 ** 2));
});

// ---------------------------------------------------------------------------------------------------
// 2. the cycle: 6 elite rounds + 1 boss round
// ---------------------------------------------------------------------------------------------------

test('endless cycle: 6 elite rounds then a boss round, repeating', () => {
  const gd = endlessGd();
  const first = gd.endlessFirstRound();
  const n = gd.endlessCfg.eliteRounds;
  assert.equal(n, 6, 'eliteRounds default');

  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < n; i++) {
      const r = first + cycle * (n + 1) + i;
      assert.ok(gd.isEndlessRound(r), `R${r} endless`);
      assert.equal(gd.isEndlessBossRound(r), false, `R${r} elite`);
      assert.equal(gd.endlessCyclePos(r), i, `R${r} cycle pos`);
    }
    const boss = first + cycle * (n + 1) + n;
    assert.equal(gd.isEndlessBossRound(boss), true, `R${boss} boss`);
    assert.equal(gd.endlessCyclePos(boss), n, `R${boss} last cycle pos`);
  }
});

test('endless elite rounds never resolve a leader template', () => {
  const gd = endlessGd();
  const tpls = gd.endlessEliteTemplates();
  assert.ok(tpls.length > 0, 'at least one usable template');
  for (const t of tpls) {
    assert.ok(gd.wave(t), `${t} exists`);
    const tpl = gd.wave(t);
    assert.ok(tpl.spawns.length > 0, `${t} has spawns`);
    // a leader template would put the boss itself on the field every endless round
    assert.ok(tpl.kind !== 'boss' && tpl.kind !== 'hidden', `${t} is not a leader template`);
    assert.ok(!tpl.spawns.some((s) => s.tag === 'boss' || s.tag === 'part'), `${t} spawns no leader/part`);
  }
  // the same round always resolves the same template
  assert.equal(gd.endlessEliteTemplate(gd.endlessFirstRound()), gd.endlessEliteTemplate(gd.endlessFirstRound()));
});

// ---------------------------------------------------------------------------------------------------
// 2b. the loop's 6 elite waves mirror the official elite rounds 8…13 IN ORDER, every cycle
// ---------------------------------------------------------------------------------------------------

test('the elite waves follow rounds 8–13 in order, and the same wave number repeats every cycle', () => {
  for (const modeId of MODES) {
    const gd = endlessGd(modeId);
    const cycle = gd.endlessCfg.eliteRounds + 1;          // 6 elite + 1 boss
    const first = gd.endlessFirstRound();

    // the template list IS the official 8…13 ladder, in wave order
    const official = [];
    for (const r of gd.endlessCfg.eliteTemplateRounds) official.push(gd.roundCfg(r).template);
    assert.deepEqual(official, gd.endlessEliteTemplates(),
      `${modeId}: the wave templates are rounds 8…13's, in order`);

    // wave k of EVERY cycle resolves the same template as cycle 1's wave k (no cross-cycle rotation)
    for (let c = 0; c < 4; c++) {
      for (let p = 0; p < gd.endlessCfg.eliteRounds; p++) {
        const r = first + c * cycle + p;
        assert.equal(gd.endlessEliteTemplate(r), official[p],
          `${modeId}: cycle ${c + 1} wave ${p + 1} (R${r}) mirrors round ${gd.endlessCfg.eliteTemplateRounds[p]}`);
      }
      // the boss position never asks for an elite template
      assert.equal(gd.isEndlessBossRound(first + c * cycle + gd.endlessCfg.eliteRounds), true,
        `${modeId}: cycle ${c + 1} wave 7 is the boss`);
    }

    // the loop's own first wave is round 8's composition, NOT round 1's (the pre-fix behaviour picked
    // act1autochess_01..06 for the first cycle, which are the normal-round templates)
    assert.equal(gd.endlessEliteTemplate(first), gd.roundCfg(8).template, `${modeId}: wave 1 = round 8`);
    assert.notEqual(gd.endlessEliteTemplate(first), gd.roundCfg(1).template, `${modeId}: not round 1's template`);
  }
});

test('every wave of the loop fields only the round’s elite enemies (no normal key leaks through)', () => {
  // The h01–h06 templates still carry N / NF / S placeholder slots; waves.js `escalate` must resolve every one of them
  // to the pick's ELITE key. This is the reason a normal-round template is safe to reuse for an endless wave.
  const gd = endlessGd();
  const factions = scheduledFactions(gd);
  const first = gd.endlessFirstRound();
  for (let c = 0; c < 2; c++) {
    for (let p = 0; p < gd.endlessCfg.eliteRounds; p++) {
      const r = first + c * (gd.endlessCfg.eliteRounds + 1) + p;
      const w = buildNormalWave(gd, createRng(1000 + r), factions, r);
      assert.equal(w.templateId, gd.endlessEliteTemplate(r), `R${r}: built from the mapped template`);
      assert.ok(w.pick, `R${r}: has a pick`);
      const keys = w.spawns.map((s) => String(s.key ?? s.enemyKey ?? s.id ?? ''));
      assert.ok(keys.length > 0, `R${r}: spawns something`);
      if (w.pick.normal) {
        assert.ok(!keys.includes(w.pick.normal), `R${r}: the NORMAL key ${w.pick.normal} never spawns`);
      }
      // every key in the wave is the pick's elite (or an escort literal), never a bare normal one
      assert.equal(new Set(keys).size, 1, `R${r}: one enemy kind only (got ${[...new Set(keys)].join(',')})`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// 3. the merged boss pool
// ---------------------------------------------------------------------------------------------------

test('endless boss pool merges the Final Assault and Hidden Core pools', () => {
  const gd = endlessGd();
  const merged = gd.endlessBossWeights();
  const ids = merged.map((p) => p[0]);
  const fa = Object.keys(gd.mode.bossWeights);
  const hc = Object.keys(gd.mode.hiddenBossWeights);
  for (const id of [...fa, ...hc]) assert.ok(ids.includes(id), `${id} present in the merged pool`);
  assert.equal(ids.length, new Set([...fa, ...hc]).size, 'no duplicates');
  // the hidden versions keep their own weights (weights are summed per id, and the pools are disjoint here)
  for (const [id, w] of merged) {
    const expected = (gd.mode.bossWeights[id] || 0) + (gd.mode.hiddenBossWeights[id] || 0);
    assert.equal(w, expected, `${id} weight`);
  }
  // every pool member is a real boss with a template in one of the two rounds
  for (const [id] of merged) {
    assert.ok(gd.boss(id), `${id} is a boss`);
    const w = buildBossWave(gd, createRng(1), [], gd.endlessFirstRound() + 6, { bossId: id, solo: true });
    assert.ok(w.templateId, `${id} resolves a template`);
  }
});

test('endless boss hp pool scales with the same compounding', () => {
  const gd = endlessGd();
  const g = gd.endlessCfg.growth;
  assert.equal(gd.endlessBossPoolMul(gd.lastRound), 1, 'official rounds unscaled');
  // the leader's shared pool rides the HP growth of the same wave number (not the defence/attack ones)
  for (const st of [1, 3, 7]) {
    assert.equal(gd.endlessBossPoolMul(gd.endlessFirstRound() + st - 1), Math.pow(g.hp, st), `step ${st}`);
  }
});

// ---------------------------------------------------------------------------------------------------
// 4. availability
// ---------------------------------------------------------------------------------------------------

test('endless is offered only where a Hidden Core exists', () => {
  const abyss = new GameData(DATA, 'mode_single_abyss');
  assert.equal(abyss.hiddenRound, 15);
  assert.equal(abyss.isEndlessAvailable(), true, 'abyss has a Hidden Core');

  const funny = new GameData(DATA, 'mode_single_funny');
  assert.equal(funny.hiddenRound, null, '标准 has no Hidden Core');
  assert.equal(funny.isEndlessAvailable(), false, 'so endless is not offered');
});

// ---------------------------------------------------------------------------------------------------
// 5. the vote
// ---------------------------------------------------------------------------------------------------

function endlessReadyMatch({ humans = 1, bots = 0, seed = 7 } = {}) {
  const h = makeMatch({ mode: bots || humans > 1 ? 'coop' : 'solo', difficulty: 'ABYSS', humans, bots, seed });
  h.start();
  const m = h.m;
  // jump straight to the prompt: the vote only needs the phase, the alive seats and the vote state
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  return h;
}

test('vote: a bot seat defaults to yes and can decide alone, entering the loop at once', () => {
  const h = endlessReadyMatch({ humans: 1, bots: 1 });
  const m = h.m;
  assert.equal(m.endlessVote.votes.get('ai_0'), true, 'bot voted yes without an answer');
  // one yes of two alive seats is already a majority, so the vote resolves immediately
  assert.equal(m.endless, true, 'entered the loop');
  assert.equal(m.round, m.gd.endlessFirstRound(), 'the loop opens at round 16');
  assert.ok(m.gd.endlessActive, 'GameData told the loop is live');
  m.dispose();
});

test('vote: a human majority is required; one yes of two is not enough', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 11 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  assert.equal(m.phase, PHASE.ENDLESS_PROMPT);
  assert.equal(m.endlessVotesNeeded(), 1, 'half of 2 rounds up to 1');

  // one yes is already a majority of two
  assert.deepEqual(m.answerEndless(m.players.get('p_0'), true), { ok: true });
  assert.equal(m.endless, true, 'entered');
  assert.equal(m.round, m.gd.endlessFirstRound(), `the loop opened (round ${m.round})`);
  m.dispose();
});

test('vote: an outright "no" majority settles the match instead of entering', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 3, bots: 0, seed: 13 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  assert.equal(m.endlessVotesNeeded(), 2, 'half of 3 rounds up to 2');

  assert.deepEqual(m.answerEndless(m.players.get('p_0'), false), { ok: true });
  assert.equal(m.endless, false, 'not entered yet');
  assert.equal(h.ended, null, 'still waiting');
  assert.deepEqual(m.answerEndless(m.players.get('p_1'), false), { ok: true });
  assert.equal(m.endless, false, 'never entered');
  assert.ok(h.ended, 'the match settled');
  assert.equal(h.ended.victory, true, 'a cleared core still wins');
  m.dispose();
});

test('vote: answering twice is rejected once the vote is decided', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, bots: 0, seed: 17 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  assert.deepEqual(m.answerEndless(m.players.get('p_0'), true), { ok: true });
  const again = m.answerEndless(m.players.get('p_0'), false);
  assert.ok(again.error, 'second answer rejected');
  assert.equal(m.endless, true, 'the first answer stands');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 6. the loop actually builds endless waves
// ---------------------------------------------------------------------------------------------------

test('endless rounds build a wave with the compounded mods on every spawn', () => {
  const gd = endlessGd();
  const factions = scheduledFactions(gd);
  for (const st of [1, 2, 7]) {
    const r = gd.endlessFirstRound() + st - 1;
    const scale = gd.enemyScale(r);
    const isBoss = gd.isEndlessBossRound(r);
    const w = isBoss
      ? buildBossWave(gd, createRng(3), factions, r, { bossId: gd.endlessBossWeights()[0][0], solo: true })
      : buildNormalWave(gd, createRng(3), factions, r);
    assert.ok(w.templateId, `R${r} (${isBoss ? 'boss' : 'elite'}) has a template`);
    assert.ok(w.spawns.length > 0, `R${r} spawns something`);
    for (const s of w.spawns) {
      if (s.tag === 'boss') continue;              // the leader takes atk/speed only, never hp
      if (s.mods && s.mods.atkMul !== undefined) assert.equal(s.mods.atkMul, scale.atkMul, `R${r} ${s.enemyKey} atkMul`);
      if (s.mods && s.mods.hpMul !== undefined) assert.equal(s.mods.hpMul, scale.hpMul, `R${r} ${s.enemyKey} hpMul`);
      assert.equal(s.mods && s.mods.defMul, scale.defMul, `R${r} ${s.enemyKey} defMul (endless +3%/round)`);
    }
  }
});

test('endless elite rounds spawn the pick\'s ELITE enemies for every placeholder slot', () => {
  const gd = endlessGd();
  const factions = scheduledFactions(gd);
  let checked = 0, checkedSpawns = 0;
  for (let st = 1; st <= 7; st++) {
    const r = gd.endlessFirstRound() + st - 1;
    if (gd.isEndlessBossRound(r)) continue;
    for (const seed of [5, 6, 7]) {
      const w = buildNormalWave(gd, createRng(seed), factions, r);
      assert.ok(w.pick, `R${r} seed ${seed} has a pick`);
      assert.equal(w.pick.endless, st, `R${r} pick carries the endless step`);
      const allowed = new Set([w.pick.elite, w.pick.key].filter(Boolean));
      for (const s of w.spawns) {
        if (s.tag) continue;                    // leader / part tags never appear in these templates
        // every PLACEHOLDER-driven spawn must be one of the pick's elite options; literal escort keys are kept
        // (that is the official template behaviour and also happens in the official rounds)
        if (allowed.has(s.enemyKey)) { checkedSpawns++; continue; }
        assert.ok(gd.isEndlessRound(r), 'literal spawn outside an endless round');
      }
      // and the elite key itself must be used somewhere (the escalation is measurable)
      const keys = new Set(w.spawns.map((s) => s.enemyKey));
      assert.ok(keys.has(w.pick.elite) || keys.has(w.pick.key),
        `R${r} seed ${seed} spawns neither the elite nor the special key (${[...keys].join(',')})`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'at least one elite round was checked');
  assert.ok(checkedSpawns > 0, 'and at least one elite spawn was seen');
});

test('endless pick falls back to the official rotation past the schedule', () => {
  const gd = endlessGd();
  const factions = scheduledFactions(gd);
  for (const st of [1, 2, 3]) {
    const r = gd.endlessFirstRound() + st - 1;
    const w = buildNormalWave(gd, createRng(9), factions, r);
    assert.ok(w.pick, `R${r} got a pick from the wrapped schedule`);
    assert.ok(w.pick.endless === st, `R${r} marks the endless step`);
    assert.ok(w.entries.ground || w.entries.fly, 'and exposes its entry view');
    assert.ok(w.spawns.length > 0, 'spawns something');
  }
});

// ---------------------------------------------------------------------------------------------------
// 6b. 机变阶段 (SP_DRAFT) inside the loop: ONE per 7-wave cycle, right after that cycle's third wave
// ---------------------------------------------------------------------------------------------------

test('the endless 机变阶段 falls ONCE PER CYCLE, right after the cycle’s third wave', () => {
  const gd = endlessGd();
  const first = gd.endlessFirstRound();
  const cycle = gd.endlessCfg.eliteRounds + 1;         // 6 elite + 1 boss = 7 waves per cycle
  assert.equal(cycle, 7, 'the cycle is 7 waves long');
  assert.equal(gd.endlessCfg.draft.afterWave, 3, 'the beat sits after the cycle’s third wave');
  assert.equal(first, 16, 'the loop opens at round 16');
  assert.equal(gd.endlessCyclePos(18), 2, 'R18 is wave 3 of cycle 1 (0-based position 2)');
  assert.equal(gd.endlessStep(18), 3, 'and endless step 3');

  // cycle 1: wave 3 = R18 → R19 drafts. cycle 2: wave 3 = R25 → R26. cycle 3: wave 3 = R32 → R33 …
  const hits = [];
  for (let r = first; r < first + 4 * cycle; r++) if (gd.isEndlessDraftRound(r)) hits.push(r);
  assert.deepEqual(hits, [19, 26, 33, 40], 'exactly one per cycle, always the wave after the third');

  // one per cycle — never two
  for (let c = 0; c < 4; c++) {
    const inCycle = hits.filter((r) => r >= first + c * cycle && r < first + (c + 1) * cycle);
    assert.equal(inCycle.length, 1, `cycle ${c + 1} has exactly one 机变 (got ${inCycle.join()})`);
  }
  // the third wave itself is still an ordinary prep round; the boss wave never drafts
  assert.equal(gd.isEndlessDraftRound(18), false, 'R18 (the third wave) is a normal prep round');
  assert.equal(gd.isEndlessDraftRound(22), false, 'R22 is the cycle boss — no 机变 there');
  assert.equal(gd.isEndlessDraftRound(29), false, 'nor the second cycle boss');
  assert.equal(gd.isEndlessDraftRound(first), false, 'the loop does not open with a draft');
  for (let r = first; r < first + 4 * cycle; r++) {
    if (gd.isEndlessBossRound(r)) assert.equal(gd.isEndlessDraftRound(r), false, `R${r} boss never drafts`);
  }
  // the official rounds are untouched
  for (const r of gd.spRounds()) assert.equal(gd.isEndlessDraftRound(r), false, `official R${r} keeps its own path`);
});

test('the endless draft schedule mirrors the official R11 shape (mixed families, tier-4..6 supply)', () => {
  const gd = endlessGd();
  const sch = gd.endlessDraftSchedule();
  assert.deepEqual(sch.families.map((f) => f.family).sort(), ['bounty', 'shop', 'tactic'], 'bounty / shop / tactic');
  assert.deepEqual(sch.supplyTiers, [4, 6], 'the richest official supply tiers');
  assert.equal(sch.cards, 3, 'solo picks 3');
  assert.equal(sch.bountyDraft, 'hunter', 'and r ≥ 11 maps to the hunter bounty pool');
  const multi = endlessGd('mode_multi_abyss');
  assert.equal(multi.endlessDraftSchedule().cards, 6, 'multi picks 6');
  // config.json can retime / reshape it
  const cfgd = new GameData(DATA, 'mode_single_abyss');
  cfgd.setEndlessActive(true);
  cfgd.config = { ...cfgd.config, endless: { draft: { afterWave: 5, families: [['supply', 1]], supplyTiers: [1, 2], cards: 5 } } };
  assert.equal(cfgd.endlessCfg.draft.afterWave, 5, 'afterWave is overridable');
  assert.deepEqual(cfgd.endlessCfg.draft.families, [['supply', 1]], 'so are the families');
  assert.deepEqual(cfgd.endlessDraftSchedule().supplyTiers, [1, 2]);
  assert.equal(cfgd.endlessDraftSchedule().cards, 5, 'and a pinned card count');
  // afterWave 5 ⇒ wave 5 of each cycle ends (R20) → R21 drafts; cycle 2's wave 5 (R27) → R28
  const f = cfgd.endlessFirstRound();
  assert.deepEqual([21, 28].map((r) => cfgd.isEndlessDraftRound(r)), [true, true], 'wave 5 → the next wave');
  assert.equal(cfgd.isEndlessDraftRound(19), false, 'and the third wave no longer does');
  assert.equal(cfgd.isEndlessDraftRound(20), false, 'the beat is after the wave, not on it');
  void f;
});

test('the loop really opens a 机变阶段 after the cycle’s third wave (R18 → R19) and then reaches PREP', () => {
  const h = endlessMatchAt(1);
  const m = h.m;
  const gd = m.gd;
  const draftRound = 19;                               // cycle 1: wave 3 is R18, so R19 opens with the 机变
  assert.equal(gd.endlessCyclePos(18), 2, 'R18 is the cycle’s third wave');
  assert.equal(gd.isEndlessDraftRound(draftRound), true);

  for (const ps of m.players.values()) ps.lp = 9999;
  let sawDraft = 0;
  const ok = h.drive(() => {
    if (m.round === draftRound && m.phase === PHASE.SP_DRAFT) sawDraft++;
    return m.phase === PHASE.PREP && m.round === draftRound + 1;
  }, { maxSteps: 8e6 });
  assert.ok(ok, `never got past round ${draftRound} (${m.phase} R${m.round}${h.ended ? ', ended' : ''})`);
  assert.ok(sawDraft > 0, `round ${draftRound} went through SP_DRAFT (saw ${sawDraft})`);
  assert.equal(m.publicView().spRound, false, 'and round 20 is a normal prep round again');
  m.dispose();
});

test('the cycle’s boss wave and the 机变 never collide (the boss keeps its own prep)', () => {
  const h = endlessMatchAt(1);
  const m = h.m;
  const gd = m.gd;
  const cycle = gd.endlessCfg.eliteRounds + 1;
  const boss = gd.endlessFirstRound() + gd.endlessCfg.eliteRounds;   // wave 7 → R22
  assert.equal(boss, 22);
  assert.equal(gd.isEndlessBossRound(boss), true);
  assert.equal(gd.isEndlessDraftRound(boss), false, 'the boss wave does not draft');
  // and the draft of that cycle sits at R19, three waves earlier
  assert.equal(gd.isEndlessDraftRound(boss - 3), true, 'the cycle’s 机变 is R19');

  for (const ps of m.players.values()) ps.lp = 9999;
  const seen = [];
  const ok = h.drive(() => {
    if (m.round === boss) { const k = m.phase; if (seen[seen.length - 1] !== k) seen.push(k); }
    return m.round === boss + 1 && m.phase === PHASE.PREP;
  }, { maxSteps: 9e6 });
  assert.ok(ok, `R${boss} never handed over to R${boss + 1} (${m.phase} R${m.round}${h.ended ? ', ended' : ''})`);
  assert.ok(!seen.includes(PHASE.SP_DRAFT), `R${boss} runs no 机变 (saw ${seen.join(' → ')})`);
  assert.ok(seen.includes(PHASE.FINAL_ASSAULT), `R${boss} is the leader fight (saw ${seen.join(' → ')})`);
  assert.equal(gd.endlessStep(m.round), cycle + 1, 'and the loop moved on to the next cycle’s first wave');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 7. result reporting
// ---------------------------------------------------------------------------------------------------

test('result reports the endless rounds reached', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, bots: 0, seed: 19 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  m.answerEndless(m.players.get('p_0'), true);
  m.endlessRound = 9;              // pretend the loop ran 9 rounds
  m.round = m.gd.endlessFirstRound() + 8;
  m.finish({ victory: true, hiddenCleared: true, reason: 'victory' });
  assert.ok(h.ended, 'finished');
  const res = m.lastResultMsg;
  assert.equal(res.endlessRound, 9, 'endlessRound in m.result');
  assert.equal(res.endlessEntered, true, 'entered flag');
  // bossRound + hidden + endless rounds
  assert.equal(res.roundsPassed, m.gd.bossRound + 1 + 9, 'roundsPassed counts the loop');
  m.dispose();
});

test('a match that never touched endless reports 0', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, bots: 0, seed: 23 });
  h.start();
  const m = h.m;
  m.finish({ victory: true, hiddenCleared: false, reason: 'victory' });
  assert.equal(m.lastResultMsg.endlessRound, 0);
  assert.equal(m.lastResultMsg.endlessEntered, false);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 9. the per-wave balance: highest bond −layerCut, target LP +lpGain (alive seats only)
// ---------------------------------------------------------------------------------------------------

/** Put `n` pieces of the same bond on the board (only needed by the tests that care about the live strip). */
function placeBond(h, ps, bondId, n) {
  const ids = h.m.gd.visibleChess.filter((id) => {
    const c = h.m.gd.chess(id);
    return c && !c.isGolden && Array.isArray(c.bonds) && c.bonds.includes(bondId);
  });
  assert.ok(ids.length, `bond ${bondId} has members`);
  const tiles = [[9, 1], [9, 2], [9, 3], [9, 4], [9, 5], [9, 6], [9, 7], [9, 8]];
  for (let i = 0; i < n; i++) give(h.m, ps, ids[i % ids.length], 'board', tiles[i % tiles.length]);
  return ids;
}

/** Drill a match into the endless loop at `wave` (an endless wave number, 1 = the first). */
function endlessMatchAt(wave, { humans = 1, seed = 37 } = {}) {
  const h = makeMatch({ mode: humans > 1 ? 'coop' : 'solo', difficulty: 'ABYSS', humans, bots: 0, seed });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  m.answerEndless(m.players.get('p_0'), true);
  m.gd.setEndlessActive(true);
  m.round = m.gd.endlessFirstRound() + wave - 1;
  return h;
}

test('endless balance: from endless wave 2 on, the HIGHEST bond is cut and LP rises (alive seats only)', () => {
  const h = endlessMatchAt(2, { humans: 2 });
  const m = h.m;
  const gd = m.gd;
  const first = gd.endlessFirstRound();
  const bal = gd.endlessCfg.balance;
  assert.equal(bal.fromWave, 2, 'the trade starts with endless wave 2');
  assert.equal(bal.layerCut, 15);
  assert.equal(bal.lpGain, 1);
  assert.equal(gd.endlessBalance(first), null, `wave ${first} (endless 1) passes untouched`);
  assert.ok(gd.endlessBalance(first + 1), `wave ${first + 1} (endless 2) triggers the trade`);

  const p0 = m.players.get('p_0');
  const p1 = m.players.get('p_1');
  const ids = gd.bondIds.slice(0, 3);
  p0.layers = { [ids[0]]: 40, [ids[1]]: 12 };
  p1.layers = { [ids[0]]: 9 };
  p0.recompute(); p1.recompute();

  const lp0 = p0.lp, lp1 = p1.lp;
  const touched = m._applyEndlessBalance();
  assert.equal(touched, 2, 'both alive seats were touched');
  assert.equal(p0.layers[ids[0]], 25, 'the highest bond lost exactly 15');
  assert.equal(p0.layers[ids[1]], 12, 'the lower bond is untouched');
  assert.equal(p0.lp, lp0 + 1, 'target LP +1');
  assert.equal(p1.layers[ids[0]], 9, 'a stack below the cut is left alone');
  assert.equal(p1.lp, lp1 + 1, 'target LP +1 anyway');

  // the eliminated are excluded
  p1.eliminate(m.round);
  const before = { lp: p1.lp, layers: { ...p1.layers } };
  m._applyEndlessBalance();
  assert.equal(p1.lp, before.lp, 'an eliminated seat gains no LP');
  assert.deepEqual(p1.layers, before.layers, 'and loses no layers');
  m.dispose();
});

test('endless balance: an inactive bond with the highest stack IS still cut (active-ness not required)', () => {
  const h = endlessMatchAt(2);
  const m = h.m;
  const ps = m.players.get('p_0');
  const bondId = m.gd.bondIds.slice().sort()[0];
  ps.layers = { [bondId]: 500 };          // no members fielded → inactive, but it holds the highest stack
  ps.recompute();
  assert.notEqual(ps.bonds[bondId]?.active, true, 'the bond really is inactive');
  m._applyEndlessBalance();
  assert.equal(ps.layers[bondId], 485, 'the highest stack is cut regardless of active-ness');
  m.dispose();
});

test('endless balance: a tie for the highest stack cuts exactly ONE of the tied bonds, at random', () => {
  const h = endlessMatchAt(2);
  const m = h.m;
  const ps = m.players.get('p_0');
  const ids = m.gd.bondIds.slice(0, 3);
  ps.layers = { [ids[0]]: 30, [ids[1]]: 30, [ids[2]]: 7 };
  ps.recompute();
  m._applyEndlessBalance();
  const cut = ids.filter((id) => ps.layers[id] === 15);
  const kept = ids.filter((id) => ps.layers[id] === 30);
  assert.equal(cut.length, 1, 'exactly one tied bond was cut');
  assert.equal(kept.length, 1, 'the other tied bond keeps its stack');
  assert.equal(ps.layers[ids[2]], 7, 'the lower bond is untouched');

  // the choice is RANDOM: over many fresh draws both tied bonds must eventually be chosen
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const ps2 = m.players.get('p_0');
    ps2.layers = { [ids[0]]: 30, [ids[1]]: 30 };
    m._applyEndlessBalance();
    if (ps2.layers[ids[0]] === 15) seen.add(ids[0]); else seen.add(ids[1]);
    if (seen.size === 2) break;
  }
  assert.equal(seen.size, 2, `both tied bonds get picked over time (saw ${[...seen].join(',')})`);
  m.dispose();
});

test('endless balance: outside the loop nothing happens; the core wave is untouched', () => {
  const gd = endlessGd();
  assert.equal(gd.endlessBalance(gd.hiddenRound), null, 'the Hidden Core takes no trade');
  assert.equal(gd.endlessBalance(1), null, 'official rounds take no trade');
  assert.equal(gd.endlessBalance(gd.lastRound), null, 'the boss round takes no trade');
  assert.equal(gd.endlessStep(gd.hiddenRound), 0, 'the core is not an endless wave');
});

test('endless balance: a bond at exactly layerCut is cut to 0 (>= not >)', () => {
  const h = endlessMatchAt(2);
  const m = h.m;
  const ps = m.players.get('p_0');
  const bondId = m.gd.bondIds.slice().sort()[0];
  ps.layers = { [bondId]: 15 };
  ps.recompute();
  m._applyEndlessBalance();
  assert.equal(ps.layers[bondId], 0, 'exactly layerCut → 0');
  m.dispose();
});

test('endless balance: a player whose every bond is below layerCut only gains LP', () => {
  const h = endlessMatchAt(2);
  const m = h.m;
  const ps = m.players.get('p_0');
  ps.layers = { [m.gd.bondIds[0]]: 14, [m.gd.bondIds[1]]: 3 };
  ps.recompute();
  const before = { ...ps.layers }, lp = ps.lp;
  m._applyEndlessBalance();
  assert.deepEqual(ps.layers, before, 'no bond holds the full cut → nothing is taken');
  assert.equal(ps.lp, lp + 1, 'but the LP still rises');
  m.dispose();
});

test('endless balance: the first endless wave passes with no trade at all', () => {
  const h = endlessMatchAt(1);
  const m = h.m;
  const ps = m.players.get('p_0');
  ps.layers = { [m.gd.bondIds[0]]: 100 };
  ps.recompute();
  const before = { ...ps.layers }, lp = ps.lp;
  assert.equal(m._applyEndlessBalance(), 0, 'nothing happens on endless wave 1');
  assert.deepEqual(ps.layers, before, 'layers intact');
  assert.equal(ps.lp, lp, 'LP unchanged');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------
// 10. sanity: I inspected the code before trusting it
// ---------------------------------------------------------------------------------------------------

test('the round map is what the loop is built on: R14 boss, R15 core, R16 first endless wave', () => {
  const gd = endlessGd();
  // these are the invariants the previous (wrong) indexing violated
  assert.equal(gd.bossRound, 14, 'the Final Assault is round 14');
  assert.equal(gd.hiddenRound, 15, 'the Hidden Core is round 15');
  assert.equal(gd.endlessFirstRound(), 16, 'the loop opens at round 16');
  assert.equal(gd.roundCfg(gd.hiddenRound).isHidden, true, 'and 15 is really the core in the data');
  assert.equal(gd.roundCfg(gd.hiddenRound).template, null, 'the core has no normal template');
  for (let r = 1; r <= gd.hiddenRound; r++) {
    assert.equal(gd.isEndlessRound(r), false, `R${r} is an official round, never endless`);
  }
});

// ---------------------------------------------------------------------------------------------------
// 12. the loop's own boss wave (the 7th wave of every cycle) must enter the boss flow, and the wave AFTER
//     it must be the next cycle — not the Hidden Core again.
// ---------------------------------------------------------------------------------------------------

/** Reach PREP of endless wave `wave` by really running the rounds (virtual time drives combat for us). */
function driveToEndlessPrep(h, wave) {
  const m = h.m;
  const round = m.gd.endlessFirstRound() + wave - 1;
  // a bare board leaks every wave, and seven leaked waves would eliminate the seat before the boss — give the
  // seats enough target LP to survive the drive (what the balance's +1/wave could never cover on its own)
  for (const ps of m.players.values()) ps.lp = 9999;
  const ok = h.drive(() => m.phase === PHASE.PREP && m.round === round, { maxSteps: 4e6 });
  assert.ok(ok, `could not reach PREP of endless wave ${wave} (round ${round}); stuck at ${m.phase} R${m.round}${h.ended ? ' (ended)' : ''}`);
  return h;
}

test('endless wave 7 (the cycle boss) enters FINAL_ASSAULT with a boss field, not a wave-less combat', () => {
  const h = endlessMatchAt(1);
  const m = h.m;
  const gd = m.gd;
  const boss = gd.endlessFirstRound() + gd.endlessCfg.eliteRounds;   // 16 + 6 = 22
  assert.equal(boss, 22, 'the first cycle boss sits at round 22');
  assert.equal(gd.isEndlessBossRound(boss), true, 'and it is recognised as the cycle boss');
  driveToEndlessPrep(h, gd.endlessCfg.eliteRounds + 1);

  for (const ps of m.alivePlayers()) if (!ps.ready) m.handle(ps.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP, { maxSteps: 2e6 });

  // THE BUG: prepEnded() only knew the two OFFICIAL boss rounds, so an endless boss round fell through to
  // startCombat() — and a boss round has no `this.wave` (its spawns live in bossWaves), so the field was empty.
  assert.equal(m.phase, PHASE.FINAL_ASSAULT, `endless wave 7 must run the boss flow, got ${m.phase}`);
  assert.ok(m.fields.length, 'a boss field was built');
  assert.ok(m.bossWaves && m.bossWaves.length, 'the boss wave was planned');
  assert.ok(m.bossWaves[0].wave.spawns.length, 'the boss wave has spawns');
  assert.equal(m.wave, null, 'a boss round never carries a normal wave');
  assert.ok(m.endlessBossId, 'the boss was drawn from the merged pool');
  assert.ok(m.bossPool && m.bossPool.maxHp > 0, 'a shared boss pool exists');
  m.dispose();
});

test('clearing the cycle boss continues to the NEXT wave instead of jumping back to the Hidden Core', () => {
  const h = endlessMatchAt(1);
  const m = h.m;
  const gd = m.gd;
  const boss = gd.endlessFirstRound() + gd.endlessCfg.eliteRounds;
  driveToEndlessPrep(h, gd.endlessCfg.eliteRounds + 1);
  for (const ps of m.alivePlayers()) if (!ps.ready) m.handle(ps.playerId, { t: 'g.ready', ready: true });
  h.run(() => m.phase !== PHASE.PREP, { maxSteps: 2e6 });
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);

  // THE OTHER HALF OF THE BUG: _finishFinal's `!hidden` branch is the FINAL-ASSAULT one — it either unlocks the
  // core (startRound(hiddenRound) → back to R15) or ends the match. An endless boss belongs to neither.
  // Everything below happens in ONE virtual step, so the field cannot win or lose the fight on its own first.
  m.hiddenBossId = m.endlessBossId || 'boss_1';   // make the "unlock the core" branch eligible on purpose
  m.hiddenLayerSum = 1e6;
  m.teamLp = 99;
  m._finalEnding = 'cleared';
  const next = boss + 1;

  // Harvest the callback _finishFinal schedules, so the transition is asserted without depending on how far the
  // virtual scheduler happens to get (the boss fields are still live in this test).
  const queued = [];
  const realLater = m.later.bind(m);
  m.later = (ms, fn) => { const t = realLater(ms, fn); queued.push(fn); return t; };
  m._finishFinal(false, () => ({ perPlayer: {} }));
  m.later = realLater;
  assert.ok(queued.length, '_finishFinal scheduled the continuation');
  for (const fn of queued) fn();

  assert.ok(!m.ended, 'an endless boss victory does not end the match');
  assert.equal(m.round, next, `continued to round ${next}, not back to the core (R${m.round})`);
  assert.notEqual(m.round, gd.hiddenRound, 'never returns to the Hidden Core');
  assert.equal(gd.endlessStep(m.round), gd.endlessCfg.eliteRounds + 2, 'and it is endless wave 8');
  assert.equal(gd.endlessCyclePos(m.round), 0, 'the start of the second cycle');
  assert.equal(gd.isEndlessBossRound(m.round), false, 'a fresh elite wave, not a boss');
  m.dispose();
});

test('the endless boss flags agree with the official boss rounds (the preview reads the same predicate)', () => {
  const gd = endlessGd();
  // the official rounds keep their own paths
  assert.equal(gd.isEndlessBossRound(gd.bossRound), false, 'R14 is a boss but not an ENDLESS boss');
  assert.equal(gd.isEndlessBossRound(gd.hiddenRound), false, 'R15 is the core, not an endless boss');
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let wave = 1; wave <= gd.endlessCfg.eliteRounds + 1; wave++) {
      const r = gd.endlessFirstRound() + cycle * (gd.endlessCfg.eliteRounds + 1) + wave - 1;
      const isBoss = gd.isEndlessBossRound(r);
      assert.equal(isBoss, wave === gd.endlessCfg.eliteRounds + 1, `cycle ${cycle + 1} wave ${wave} (R${r}) boss flag`);
      assert.equal(gd.endlessCyclePos(r), wave - 1, `cycle ${cycle + 1} wave ${wave} position`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// 11. wire protocol: m.endless is pushed, and the vote travels through onMessage
// ---------------------------------------------------------------------------------------------------

test('the prompt pushes m.endless with the tally, and the answer round-trips through onMessage', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 29 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  h.sent.length = 0;                       // ignore the handshake traffic
  m.enterEndlessPrompt();

  const pushed = h.sent.filter(([, msg]) => msg.t === 'm.endless').map(([id, msg]) => ({ id, msg }));
  assert.equal(pushed.length, 2, 'one m.endless per seat (a repeat with the same tally is deduped)');
  assert.deepEqual(pushed.map((p) => p.id).sort(), ['p_0', 'p_1'], 'one for each seat');
  for (const { msg } of pushed) {
    assert.equal(msg.needed, 1, 'majority of two alive seats');
    assert.deepEqual(msg.votes, {}, 'nothing answered yet');
    assert.equal(msg.you, null, 'this seat has not answered');
    assert.equal(msg.decided, null, 'still open');
  }

  // the vote must be accepted through the normal message path (g.endless)
  const res = m.handle('p_0', { t: 'g.endless', enter: true });
  assert.deepEqual(res, { ok: true }, 'g.endless accepted');
  assert.equal(m.endless, true, 'entered');
  assert.equal(m.round, m.gd.endlessFirstRound(), 'the loop started at the first endless wave');

  // a second g.endless after the vote resolved is refused
  const again = m.handle('p_1', { t: 'g.endless', enter: true });
  assert.ok(again.error, 'refused once decided');
  m.dispose();
});

test('an unanswered ballot times out and settles the match instead of hanging', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 31 });
  h.start();
  const m = h.m;
  m.hiddenReached = true;
  m.phase = PHASE.HIDDEN_CORE;
  m.enterEndlessPrompt();
  assert.equal(m.phase, PHASE.ENDLESS_PROMPT);
  // the timeout is armed silently (setDeadline silent ⇒ public deadline 0), but the timer exists
  assert.ok(m._phaseTimer, 'a vote timeout is armed');
  h.drive(() => !!h.ended, { maxMs: 200000 });
  assert.ok(h.ended, 'the match settled');
  assert.equal(m.endless, false, 'endless was not entered');
  assert.equal(h.ended.victory, true, 'a cleared core still counts as a win');
  m.dispose();
});
