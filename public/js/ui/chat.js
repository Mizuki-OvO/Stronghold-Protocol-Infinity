// 打字聊天 (typed chat, Infinity fork): the panel the co-op modes use to actually talk to each other.
//
// The official mode ships only the 36 canned emotes (ui/emotes.js); this is a remake feature. The server owns the truth:
// `g.chat { text }` → `m.chat { playerId, name, text, at }` broadcast to every seat AND spectator, plus `m.chatLog`
// when a socket (re)joins. See server/match/Match.js chat() / chatBacklog().
//
// Rules the UI mirrors from the server, so a refusal is visible before it happens:
//   * solo matches have no chat (the server answers WRONG_PHASE) — the panel is not rendered there at all
//   * text is trimmed, whitespace-collapsed and cut to CHAT_MAX_LEN
//   * a short burst is allowed, then one line per CHAT_COOLDOWN_MS
import { html, Icon, MicroLabel } from './components.js';
import { CHAT_MAX_LEN, CHAT_LOG_MAX, CHAT_TTL_MS } from '../../../shared/constants.js';

/** How long a line stays as an on-screen bubble over the board (the panel's log keeps it regardless). */
export const chatBubbleMs = CHAT_TTL_MS;

/** The lines still worth showing as a bubble over the board right now. */
export function recentChat(lines, now, ttl = CHAT_TTL_MS) {
  return (Array.isArray(lines) ? lines : []).filter((l) => l && now - (l.at ?? 0) < ttl);
}

/** 12:34 — the panel's per-line timestamp. */
export function chatClock(at) {
  const d = new Date(Number.isFinite(at) ? at : Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The bubble text of an incoming line, or null when there is nothing to show. */
export function chatBubbleText(line) {
  if (!line || typeof line.text !== 'string') return null;
  const t = line.text.trim();
  return t ? t : null;
}

/**
 * The unread count while the panel is closed: lines that arrived after `seenAt` and were not mine.
 * @param {Array<any>} lines
 * @param {number} seenAt timestamp the panel was last opened
 * @param {string|null} myId
 */
export function unreadCount(lines, seenAt, myId) {
  return (Array.isArray(lines) ? lines : [])
    .filter((l) => l && l.playerId !== myId && (l.at ?? 0) > (seenAt || 0)).length;
}

/** The server's own normalisation, mirrored so the input and the wire agree (see Match.chat). */
export function normalizeChatText(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
}

/**
 * The chat panel: a toggle button (with an unread badge) and, when open, the log + the input.
 *
 * @param {{ open: boolean, onToggle: Function, lines?: Array<any>, myId?: string|null,
 *   onSend: (text: string) => void, disabled?: boolean, unread?: number }} props
 */
export function ChatPanel({ open, onToggle, lines = [], myId = null, onSend, disabled = false, unread = 0 }) {
  const shown = (Array.isArray(lines) ? lines : []).slice(-CHAT_LOG_MAX);
  const submit = (e) => {
    e.preventDefault();
    const input = e.target && e.target.elements ? e.target.elements.text : null;
    const text = normalizeChatText(input && input.value);
    if (!text || disabled) return;
    onSend(text);
    if (input) input.value = '';
  };
  return html`<div class=${`chat${open ? ' is-open' : ''}`}>
    <button type="button" class="chat__btn" aria-label="聊天" title=${open ? '收起聊天' : '聊天（按 T）'}
        aria-expanded=${String(!!open)} onClick=${onToggle}>
      <${Icon} name="chat" />
      ${!open && unread > 0 ? html`<span class="chat__badge" aria-label=${`${unread} 条未读`}>${unread > 9 ? '9+' : unread}</span>` : null}
    </button>
    ${open ? html`<div class="chat__panel" role="dialog" aria-label="聊天">
      <div class="chat__head"><${MicroLabel}>聊天</${MicroLabel}>
        <button type="button" class="chat__close" aria-label="关闭" onClick=${onToggle}><${Icon} name="close" /></button>
      </div>
      <div class="chat__log" role="log" aria-live="polite">
        ${shown.length
          ? shown.map((l, i) => html`<p key=${`${l.at}-${i}`} class=${`chat__line${l.playerId === myId ? ' is-mine' : ''}`}>
              <span class="chat__who">${l.name || '？'}</span>
              <span class="chat__text">${l.text}</span>
              <span class="chat__at">${chatClock(l.at)}</span>
            </p>`)
          : html`<p class="chat__empty">还没有人说话。</p>`}
      </div>
      <form class="chat__form" onSubmit=${submit}>
        <input class="chat__input" name="text" type="text" autocomplete="off" maxlength=${CHAT_MAX_LEN}
          placeholder=${disabled ? '连接断开…' : '说点什么…（回车发送）'} disabled=${disabled} aria-label="聊天内容" />
        <button type="submit" class="chat__send" disabled=${disabled} aria-label="发送"><${Icon} name="check" /></button>
      </form>
    </div>` : null}
  </div>`;
}

export { CHAT_MAX_LEN, CHAT_LOG_MAX };
