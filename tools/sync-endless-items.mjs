// Sync 无尽模式's special items into data/items.json (run with `node tools/sync-endless-items.mjs`).
//
// WHY this exists: the endless special items are defined in code (server/match/gamedata.js DEFAULTS.endless.shop.items,
// overridable from config.json `endless.shop.items`) because the game ships no research data for them — they are not in
// the official item tables, so tools/build-data.mjs never builds them. But the CLIENT reads its item text from
// data/items.json (public/js/data.js `lookup('items', id)`), which is what draws the shop card and the item info popup
// (detailPanel.js ItemDetail). Without an entry there, an endless item renders as a bare id: no name, no description,
// and `resolveDetail` returns null, so right-clicking the card opens nothing.
//
// This script materialises the specs as ordinary items.json records via the SAME builder the server uses
// (gamedata.endlessItemRecord — a frozen-DEFAULTS clone per mode, so config.json overrides are picked up too), keyed and
// ordered exactly like the generated file (compact JSON, `localeCompare(numeric)` id order).
//
// It is IDEMPOTENT: re-running it replaces the endless entries and leaves every official item byte-identical. Run it
// after changing the specs, and after `npm run build-data` (which rewrites items.json from research data and therefore
// drops these entries again).
//
//   node tools/sync-endless-items.mjs            # write
//   node tools/sync-endless-items.mjs --check    # exit 1 when data/items.json is out of date
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { GameData, endlessItemRecord, DEFAULTS } from '../server/match/gamedata.js';
import { getData, ROOT, DATA_DIR } from '../server/data.js';

const CHECK = process.argv.includes('--check');
const ITEMS = join(DATA_DIR, 'items.json');
const log = (...a) => console.log('[sync-endless-items]', ...a);

/** The specs that apply to a mode: config.json `endless.shop.items` when present, else the code defaults. */
function specsFor(modeId) {
  const gd = new GameData(getData({ log: { warn() {}, error() {}, info() {} } }), modeId);
  return gd.endlessCfg.shop.items;
}

async function main() {
  const raw = await readFile(ITEMS, 'utf8');
  const items = JSON.parse(raw);

  // Drop anything a previous run added, so the file always ends up as "generated items + current specs".
  const removed = Object.keys(items).filter((id) => items[id] && items[id].endless === true);
  for (const id of removed) delete items[id];

  // Build from the specs. Every mode falls back to the same DEFAULTS list, so one pass is enough — but walk the real
  // mode ids so a config.json override of `endless.shop.items` is honoured too.
  const modes = Object.keys((getData().config && getData().config.modes) || {}).sort();
  const built = new Map();
  for (const modeId of modes) {
    for (const spec of specsFor(modeId)) {
      const rec = endlessItemRecord(spec);
      if (!rec) continue;
      if (!built.has(rec.id)) built.set(rec.id, rec);
    }
  }
  if (!built.size) {
    // No modes at all (a trimmed checkout): fall back to the defaults so the file is still complete.
    for (const spec of DEFAULTS.endless.shop.items) {
      const rec = endlessItemRecord(spec);
      if (rec) built.set(rec.id, rec);
    }
  }

  const next = { ...items };
  for (const [id, rec] of built) next[id] = rec;
  const sorted = {};
  for (const id of Object.keys(next).sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))) {
    sorted[id] = next[id];
  }

  const text = JSON.stringify(sorted);
  const stale = text !== raw;
  const added = [...built.keys()].sort();
  if (!stale) {
    log(`up to date — ${added.length} endless item(s): ${added.join(', ')}`);
    return 0;
  }
  if (CHECK) {
    log(`OUT OF DATE — data/items.json must be regenerated (${added.length} endless item(s) expected)`);
    log(`run: node tools/sync-endless-items.mjs`);
    return 1;
  }
  const tmp = `${ITEMS}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, ITEMS);
  log(`wrote ${ITEMS}`);
  log(`  official items kept : ${Object.keys(sorted).length - added.length}`);
  log(`  endless items synced: ${added.length} → ${added.join(', ')}`);
  if (removed.length) log(`  replaced            : ${removed.join(', ')}`);
  return 0;
}

void ROOT;
process.exit(await main());
