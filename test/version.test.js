// Release metadata: one version everywhere (package.json, package-lock.json, shared/constants.js APP_VERSION shown on
// the title screen, the server banner and /healthz), the GPL-3.0-or-later licence (LICENSE, package.json, lockfile) and
// the notice files the README and the release bundle point at.
//
// INFINITY FORK: the repository name, the release version's suffix and the repository URL are this fork's own, so those
// assertions name the fork. Everything that is about the GAME (its official English title, the GPL licence, the notice
// files, the upstream credit) is checked exactly as upstream had it — the fork must not drift from those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION, PROTOCOL_VERSION } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
/** This fork. */
const FORK = { name: 'stronghold-protocol-infinity', repo: 'Mizuki-OvO/Stronghold-Protocol-Infinity' };
/** The upstream original the fork is built on — credited everywhere, never renamed. */
const UPSTREAM = { repo: 'sganggs/Stronghold-Protocol', version: '0.1.3' };

test('one release version: package.json, package-lock.json and APP_VERSION', () => {
  // the fork appends a suffix to the upstream version (0.2.0-infinity.1); the leading x.y.z stays semver
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.\-]+)?$/, 'semver with an optional pre-release suffix');
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages[''].version, APP_VERSION);
  assert.equal(PROTOCOL_VERSION, 1, 'the wire protocol number is separate from the release version');
  assert.equal(pkg.private, true, 'never published to npm');
});

test('CHANGELOG.md opens with the release version, and the README links it', () => {
  const log = read('CHANGELOG.md');
  const first = log.match(/^## (\S+) — (\d{4}-\d{2}-\d{2})/m);
  assert.ok(first, 'a "## x.y.z — date" heading');
  assert.equal(first[1], APP_VERSION, 'the newest entry is the current version');
  assert.match(log, /^## 0\.1\.0 — 2026-10-02/m, 'the first public release stays listed');
  // the fork's entry must sit ABOVE the upstream one and the upstream entry must survive verbatim
  assert.match(log, new RegExp(`^## ${UPSTREAM.version} — `, 'm'), `the upstream ${UPSTREAM.version} entry is kept`);
  assert.ok(log.indexOf(`## ${APP_VERSION} —`) < log.indexOf(`## ${UPSTREAM.version} —`), 'fork entry first');
  const readme = read('README.md');
  assert.match(readme, /\[CHANGELOG\.md\]\(CHANGELOG\.md\)/);
  assert.match(readme, new RegExp(`badge/version-${APP_VERSION.replace(/[.\-]/g, (m) => (m === '.' ? '\\.' : '--'))}-`), 'the README badge');
});

test('the release version is what players see', () => {
  assert.match(read('public/js/screens/title.js'), /v\$\{APP_VERSION\}/, 'title screen footer');
  assert.ok(!/PROTOCOL v1/.test(read('public/js/screens/title.js')), 'no protocol number posing as a version');
  const server = read('server/index.js');
  assert.match(server, /Stronghold Protocol: Alliance v\$\{APP_VERSION\}/, 'boot banner');
  assert.match(server, /app: APP_VERSION/, '/healthz');
});

test('the English title is the official one: Stronghold Protocol: Alliance (as in the reply to GitHub issue #38, which stays open)', () => {
  // EN client data, activity_table basicInfo.act2autochess.name = "Stronghold Protocol: Alliance" (CN 卫戍协议:盟约);
  // the project used to call it "Covenant". This is the GAME's title, so the fork keeps it verbatim — only the
  // repository/product name carries the fork's "Infinity" suffix (checked separately below).
  const readme = read('README.md');
  assert.match(readme.split('\n')[0], /^# 卫戍协议：盟约 · Stronghold Protocol: Infinity$/, 'README title names the fork');
  assert.match(readme, /Stronghold Protocol: Alliance/, 'the README states the game’s official English title');
  assert.match(read('server/index.js'), /卫戍协议：盟约 · Stronghold Protocol: Alliance v/, 'boot banner');
  assert.equal(pkg.name, FORK.name);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.version, pkg.version);
  for (const f of ['README.md', 'server/index.js', 'package.json', 'package-lock.json', 'NOTICE.md', 'public/index.html', 'docs/DEPLOY.md']) {
    assert.ok(!/covenant/i.test(read(f)), `${f}: no "Covenant" title left`);
  }
});

test('the fork credits its upstream: README, NOTICE and package metadata all point back', () => {
  // GPL requires keeping the upstream authorship visible; the fork also states the baseline version it came from.
  for (const f of ['README.md', 'NOTICE.md', 'package.json', 'CHANGELOG.md']) {
    assert.ok(read(f).includes(UPSTREAM.repo), `${f}: links upstream ${UPSTREAM.repo}`);
  }
  assert.ok(read('NOTICE.md').includes(UPSTREAM.version), 'NOTICE states the upstream baseline version');
  assert.ok(read('CHANGELOG.md').includes(UPSTREAM.version), 'CHANGELOG keeps the upstream entries');
  assert.ok(read('README.md').includes(FORK.repo), 'README links this fork');
  assert.match(pkg.homepage, /Stronghold-Protocol-Infinity/, 'homepage is the fork');
});

test('GPL-3.0-or-later: LICENSE, package metadata and notices', () => {
  const license = read('LICENSE');
  assert.match(license.slice(0, 200), /GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
  assert.equal(pkg.license, 'GPL-3.0-or-later');
  assert.equal(lock.packages[''].license, 'GPL-3.0-or-later');
  // the fork is a derivative of the upstream GPL project, so the upstream URL stays visible in the metadata too
  assert.match(pkg.repository.url, new RegExp(FORK.repo));
  assert.match(pkg.upstream.url, new RegExp(UPSTREAM.repo), 'the upstream repo is still linked');
  assert.equal(pkg.upstream.baseline, UPSTREAM.version, 'and the baseline version it came from');
  for (const f of ['NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'tools/local-extract/LICENSE-Ark-Unpacker.txt']) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
  const notice = read('NOTICE.md');
  assert.match(notice, /GPL-3\.0-or-later/);
  assert.match(notice, /非商业/);
  assert.match(notice, /section 7/, 'the Spine Runtimes linking permission');
  assert.match(notice, /本仓库是改版（Provenance）/, 'NOTICE opens with the fork provenance');
  const aklz4 = read('tools/local-extract/aklz4.py');
  assert.match(aklz4, /SPDX-License-Identifier: BSD-3-Clause/);
  assert.match(aklz4, /Copyright \(c\) 2022, Harry Huang/);
});
