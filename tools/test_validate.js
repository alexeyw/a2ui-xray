#!/usr/bin/env node
/* Checks validate.js against the official A2UI v1.0 examples: every message must pass,
   and every mutation of them (a renamed property, a dropped component name, a wrong type) must be caught.
   Usage: node tools/test_validate.js   (Node 18+; downloads the examples from GitHub at the
   commit schemas.js was built from) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'schemas.js'));
const V = require(path.join(root, 'validate.js'));
const commit = (fs.readFileSync(path.join(root, 'schemas.js'), 'utf8').match(/at commit (\w+)/) || [])[1];
const api = `https://api.github.com/repos/a2ui-project/a2ui/contents/catalogs/basic/v1/examples?ref=${commit}`;
const get = async url => { const r = await fetch(url, { headers: { 'User-Agent': 'a2ui-xray-test' } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

(async () => {
  const list = await get(api);
  const files = await Promise.all(list.filter(f => f.name.endsWith('.json')).map(async f => ({ name: f.name, data: await get(f.download_url) })));
  let messages = 0, rejected = 0;
  for (const f of files) {
    const catalogs = {};
    for (const m of f.data.messages) {
      messages++;
      if (m.createSurface) catalogs[m.createSurface.surfaceId] = m.createSurface.catalogId;
      const errs = V.validate(m, id => catalogs[id]);
      if (errs.length) { rejected++; console.log('REJECTED', f.name, errs.map(e => e.text)); }
    }
  }
  let seed = 7, mutations = 0, missed = 0;
  const rnd = k => (seed = (seed * 1103515245 + 12345) % 2147483648) % k;
  for (const f of files) for (const m of f.data.messages) {
    const b = m.updateComponents || m.createSurface;
    if (!b || !b.components) continue;
    for (let t = 0; t < 6; t++) {
      const mm = JSON.parse(JSON.stringify(m)), bb = mm.updateComponents || mm.createSurface;
      const c = bb.components[rnd(bb.components.length)], keys = Object.keys(c).filter(k => k !== 'id'), k = keys[rnd(keys.length)];
      if (t % 3 === 0) { c[k + 'X'] = c[k]; delete c[k]; }
      else if (t % 3 === 1) delete c.component;
      else c[k] = typeof c[k] === 'number' ? 'str' : 12345;
      mutations++;
      if (!V.validate(mm, () => V.BASIC).length) { missed++; console.log('MISSED', f.name, ['rename', 'drop component', 'retype'][t % 3], c.id, k); }
    }
  }
  console.log(`${files.length} example files at ${commit}: ${messages} messages, ${rejected} rejected; ${mutations} mutations, ${missed} missed`);
  process.exit(rejected || missed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
