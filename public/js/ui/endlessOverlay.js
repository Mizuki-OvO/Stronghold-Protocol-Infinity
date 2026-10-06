// 无尽模式 confirmation (docs/ENDLESS.md).
//
// Shown after a CLEARED Hidden Core: the server moves the match into PHASE.ENDLESS_PROMPT and waits for a majority of
// the alive seats. This overlay is the ballot — it names what the loop does (6 elite rounds + 1 boss round, enemy
// stats compounding off the last official round), shows the live tally, and sends `g.endless`.
//
// The outcome is never predicted here: the overlay disappears when the server leaves the phase, and the tally comes
// from the `m.endless` push (ui state `endless`).

import { html, Modal, Button, MicroLabel } from './components.js';
import { actions } from './gameActions.js';

/** Local class joiner (components.js `cx` is not exported for reuse here). */
function cxLocal(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** "+5% 生命 / +3% 攻击 / +3% 防御" of the endless compounding, as the server's config reports it. */
function growthText(growth) {
  if (!growth) return null;
  const pct = (v) => {
    const n = (Number(v) - 1) * 100;
    return Number.isFinite(n) && n > 0 ? `+${n.toFixed(n % 1 === 0 ? 0 : 1)}%` : null;
  };
  const parts = [];
  if (pct(growth.hp)) parts.push(`${pct(growth.hp)} 生命`);
  if (pct(growth.atk)) parts.push(`${pct(growth.atk)} 攻击`);
  if (pct(growth.def)) parts.push(`${pct(growth.def)} 防御`);
  return parts.length ? parts.join(' · ') : null;
}

/** The live tally: how many alive seats must answer yes, and what has come in so far. */
function tally(vote, players, myId) {
  const alive = (players || []).filter((p) => p.alive);
  const votes = vote?.votes || {};
  let yes = 0, no = 0, waiting = 0;
  const lines = [];
  for (const p of alive) {
    const v = votes[p.playerId];
    if (v === true) yes++;
    else if (v === false) no++;
    else waiting++;
    lines.push({
      playerId: p.playerId,
      name: p.name || p.playerId,
      you: p.playerId === myId,
      state: v === true ? 'yes' : v === false ? 'no' : 'wait',
    });
  }
  return { yes, no, waiting, needed: Number.isFinite(vote?.needed) ? vote.needed : Math.max(1, Math.ceil(alive.length / 2)), lines };
}

/**
 * @param {{ open:boolean, vote:any, pub:any, myId:string, alive:boolean, busy:boolean }} props
 */
export function EndlessOverlay({ open, vote, pub, myId, alive, busy = false }) {
  if (!open) return null;
  const info = pub?.endless;
  const t = tally(vote, pub?.players, myId);
  const answered = vote?.you === true || vote?.you === false;
  const growth = growthText(info?.growth);
  const cycleLen = info?.cycleLength ?? 7;
  const eliteRounds = Math.max(1, cycleLen - 1);

  const body = html`
    <div class="endless">
      <p class="endless__lead">
        隐秘核心已通过。是否继续进入 <b>无尽模式</b>？
      </p>
      <ul class="endless__facts">
        <li><span class="endless__k">循环</span>每 <b>${cycleLen}</b> 波为一轮：<b>${eliteRounds}</b> 波精英 + <b>1</b> 波首领</li>
        <li><span class="endless__k">成长</span>${growth ? html`每一波在此基础上再叠加 <b>${growth}</b>` : html`每一波敌人数值继续增长`}</li>
        <li><span class="endless__k">首领</span>从最终攻势与隐秘核心的首领池中抽取</li>
        <li><span class="endless__k">结束</span>战败即结算本局，并记录你到达的波数</li>
      </ul>

      <div class="endless__tally">
        <div class="endless__bar" role="img" aria-label=${`${t.yes} / ${t.needed} 同意`}>
          <div class="endless__bar-fill" style=${`width:${Math.min(100, (t.yes / Math.max(1, t.needed)) * 100)}%`}></div>
        </div>
        <div class="endless__counts">
          <span class="is-yes">同意 ${t.yes}</span>
          <span class="is-no">拒绝 ${t.no}</span>
          <span class="is-wait">未表态 ${t.waiting}</span>
          <${MicroLabel}>过半即进入（需 ${t.needed} 票）<//>
        </div>
        <ul class="endless__votes">
          ${t.lines.map((l) => html`<li class=${cxLocal('endless__vote', `is-${l.state}`, l.you && 'is-you')}>
            <span class="endless__vote-name">${l.name}${l.you ? '（你）' : ''}</span>
            <span class="endless__vote-state">${l.state === 'yes' ? '同意' : l.state === 'no' ? '拒绝' : '等待…'}</span>
          </li>`)}
        </ul>
      </div>
    </div>`;

  // The modal has no backdrop dismissal: an unanswered ballot times out on the server (30 s), which settles the match.
  return html`<${Modal}
    open=${open}
    tone="amber"
    micro="ENDLESS"
    title="无尽模式"
    width="min(560px, 92vw)"
    closeOnBackdrop=${false}
    onClose=${null}
    class="endless-modal"
    actions=${alive
      ? html`
        <${Button} variant="ghost" size="lg" icon="exit" disabled=${busy || answered}
          onClick=${() => actions.endless(false)}>结算本局<//>
        <${Button} variant="primary" size="lg" icon="check" disabled=${busy}
          onClick=${() => actions.endless(true)}>${answered && vote?.you === true ? '已同意' : '进入无尽'}<//>`
      : html`<${MicroLabel}>你已出局，由仍在场的队友决定<//>`}
  >${body}<//>`;
}
