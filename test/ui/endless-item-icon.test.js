// 无尽模式's special items have EMOJI icons and no manifest art, so their icon must be painted as real DOM TEXT —
// never through an <img>. An SVG data URL whose <text> holds an emoji does not render reliably in Chrome (the glyph
// comes out as a tofu box), and the <Img> fallback then shows the name's first character, i.e. the "?" players saw on
// the shop card, the info popup header and an operator's equipped-item rows.
//
// The records reach the client through data/items.json (mirrored by tools/sync-endless-items.mjs); these tests pin the
// RENDER branch, which is what was broken. Official items must keep using the manifest <img> path.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data, loadData } = await import('../../public/js/data.js');
const { UnitThumb } = await import('../../public/js/ui/gameComponents.js');
const { ItemDetail } = await import('../../public/js/ui/detailPanel.js');
const { itemIconUrl, itemEmoji } = await import('../../public/js/ui/assetUrls.js');

await loadData('items', 'assets');
const ITEMS = JSON.parse(readFileSync(path.join(ROOT, 'data', 'items.json'), 'utf8'));
const ENDLESS = Object.values(ITEMS).filter((r) => r.endless === true);
/** An official item to compare against (人事部文档: the deploy-cap item the endless capstone depends on). */
const OFFICIAL = 'chess_item_6_08_e_a';

/**
 * Expand a vnode tree into what the DOM would contain. Components that need hooks (RichText) are not called: their
 * input is collected from props instead.
 */
function scan(node, out = { tags: [], texts: [], imgSrcs: [], richTexts: [] }, depth = 0) {
  if (depth > 40 || node == null || node === false) return out;
  if (Array.isArray(node)) { for (const n of node) scan(n, out, depth + 1); return out; }
  if (typeof node === 'object' && node.props) {
    const { type, props } = node;
    if (typeof type === 'string') out.tags.push(type);
    if (typeof props.class === 'string') out.tags.push(props.class);
    if (props.src) out.imgSrcs.push(String(props.src));
    if (type && type.name === 'RichText' && typeof props.text === 'string') out.richTexts.push(props.text);
    scan(props.children, out, depth + 1);
    return out;
  }
  const s = String(node).trim();
  if (s) out.texts.push(s);
  return out;
}

describe('无尽特殊道具的图标（emoji 文本，不是 <img>）', () => {
  test('every endless item carries an emoji icon in items.json (the mirror the client reads)', () => {
    assert.ok(ENDLESS.length >= 6, `at least the 6 special items (got ${ENDLESS.length})`);
    for (const it of ENDLESS) {
      assert.ok(typeof it.iconEmoji === 'string' && it.iconEmoji, `${it.id}: iconEmoji`);
      assert.ok(it.name && it.desc, `${it.id}: name + desc`);
      // no manifest art exists for them — that is exactly why an emoji is used
      assert.ok(!it.trapId, `${it.id}: no trapId`);
    }
  });

  test('UnitThumb paints the emoji as text instead of falling back to a "?" glyph', () => {
    for (const it of ENDLESS) {
      const r = scan(UnitThumb({ kind: 'item', id: it.id, size: 'sm' }));
      assert.ok(r.tags.includes('uthumb__emoji'), `${it.name}: uses the uthumb__emoji text span`);
      assert.ok(r.texts.includes(it.iconEmoji), `${it.name}: renders the emoji ${it.iconEmoji}`);
      assert.ok(!r.tags.includes('uthumb__glyph'), `${it.name}: never falls back to the "?" glyph`);
      assert.equal(r.imgSrcs.length, 0, `${it.name}: no <img> at all`);
    }
  });

  test('the info popup header shows the emoji, the name and the effect text', () => {
    for (const it of ENDLESS) {
      const r = scan(ItemDetail({ item: it, piece: null, editable: false, onDestroy: () => {} }));
      assert.ok(r.tags.includes('dhead__emoji'), `${it.name}: uses the dhead__emoji text span`);
      assert.ok(r.texts.includes(it.iconEmoji), `${it.name}: renders the emoji ${it.iconEmoji}`);
      assert.ok(r.texts.includes(it.name), `${it.name}: shows its name`);
      assert.ok(r.richTexts.includes(it.desc), `${it.name}: shows its effect line`);
      assert.equal(r.imgSrcs.length, 0, `${it.name}: no <img> in the popup header`);
    }
  });

  test('official items keep the manifest <img> path (the emoji branch must not swallow them)', () => {
    const official = data.lookup('items', OFFICIAL);
    assert.ok(official && !official.endless, 'the control item is an official one');
    assert.equal(itemEmoji(official), null, 'no emoji on an official item');

    const thumb = scan(UnitThumb({ kind: 'item', id: OFFICIAL, size: 'sm' }));
    assert.ok(!thumb.tags.includes('uthumb__emoji'), 'no emoji branch');
    assert.equal(thumb.imgSrcs.length, 1, 'one <img>');
    assert.match(thumb.imgSrcs[0], /^\/assets\/item\/.+\.png$/, `manifest url (got ${thumb.imgSrcs[0]})`);

    const popup = scan(ItemDetail({ item: official, piece: null, editable: false, onDestroy: () => {} }));
    assert.ok(!popup.tags.includes('dhead__emoji'), 'no emoji branch in the popup');
    assert.equal(popup.imgSrcs.length, 1, 'one <img> in the popup header');
  });

  test('itemIconUrl still returns a usable URL for both kinds (no caller is left with null)', () => {
    const m = data.get('assets');
    for (const it of ENDLESS) {
      const url = itemIconUrl(m, it);
      assert.ok(typeof url === 'string' && url.length, `${it.name}: a URL`);
      // the emoji route is an SVG data URL; the components above do not use it any more, but any other consumer
      // (effects lists, tooling) must still get something
      assert.match(url, /^data:image\/svg\+xml,/, `${it.name}: emoji data URL`);
    }
    const official = data.lookup('items', OFFICIAL);
    assert.match(itemIconUrl(m, official), /^\/assets\//, 'official items resolve to manifest art');
  });

  test('the emoji render CSS exists for all three surfaces', () => {
    const css = readFileSync(path.join(ROOT, 'public', 'css', 'endless.css'), 'utf8');
    for (const cls of ['.scard__emoji', '.uthumb__emoji', '.dhead__emoji']) {
      assert.ok(css.includes(cls), `${cls} is styled`);
    }
    // the thumbnail emoji must follow the tile size variable the thumbnail itself uses
    assert.match(css, /\.uthumb__emoji\s*\{[^}]*var\(--ut/, 'the thumbnail emoji scales with --ut');
    assert.match(css, /Segoe UI Emoji/, 'the platform emoji font stack is declared');
  });
});
