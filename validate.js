/* A2UI v1.0 message check against the official JSON Schemas (schemas.js).
   A small draft 2020-12 validator for the keywords those schemas use, with errors written for people:
   a oneOf is narrowed by its discriminator (component, @call) or by the branch that got furthest,
   so a typo yields one message at the right place instead of eighteen failed alternatives.
   Works in the browser (window.A2UIValidate) and in Node (require). */
(function (G) {
  'use strict';
  const BASIC = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
  const KEYS = { createSurface: 'CreateSurface', updateComponents: 'UpdateComponents', updateDataModel: 'UpdateDataModel',
    deleteSurface: 'DeleteSurface', callRendererFunction: 'CallRendererFunction', agentFunctionResponse: 'AgentFunctionResponse' };
  /* a catalog we do not have: components and functions pass, only the envelope and common types are checked */
  const OPEN = { $defs: { anyComponent: { type: 'object', required: ['component'], properties: { component: { type: 'string' } }, additionalProperties: true },
    anyFunction: { type: 'object', additionalProperties: true } } };

  const S = () => G.A2UI_SCHEMAS;
  const unesc = k => k.replace(/~1/g, '/').replace(/~0/g, '~');
  function resolve(ref, doc, cat) {
    const i = ref.indexOf('#'), file = i < 0 ? ref : ref.slice(0, i), frag = i < 0 ? '' : ref.slice(i + 1);
    let d = doc;
    if (file) d = file.endsWith('common_types.json') ? S().common : file.endsWith('catalog.json') ? cat : file.endsWith('agent_to_renderer.json') ? S().agent : null;
    let s = d;
    for (const k of frag.split('/').slice(1).map(unesc)) s = s == null ? s : s[k];
    return [s, d];
  }
  const kind = x => x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x === 'number' ? (Number.isInteger(x) ? 'integer' : 'number') : typeof x;
  const typeOk = (t, x) => { const k = kind(x); return t === k || (t === 'number' && k === 'integer'); };
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;
  const eq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const reCache = new Map();
  const re = p => { if (!reCache.has(p)) { let r; try { r = new RegExp(p, 'u'); } catch (e) { r = /.*/; } reCache.set(p, r); } return reCache.get(p); };
  const A = { string: 'a string', number: 'a number', integer: 'a whole number', boolean: 'true or false', array: 'an array', object: 'an object', null: 'null' };
  const shortJ = v => { const s = JSON.stringify(v); return s.length > 40 ? s.slice(0, 39) + '…' : s; };
  const said = x => x === null ? 'null' : Array.isArray(x) ? 'an array' : typeof x === 'object' ? 'an object' : typeof x === 'string' ? 'the string ' + shortJ(x) : (typeof x === 'number' ? 'the number ' : '') + String(x);
  const orList = xs => { xs = [...new Set(xs)]; return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1]; };
  const E = (ip, msg, k) => ({ ip, msg, k });

  function describe(s, doc, cat, d = 0) {
    if (!s || typeof s !== 'object' || d > 4) return 'something else';
    if (s.$ref) {
      const name = s.$ref.split('/').pop();
      if (name === 'DataBinding') return 'a {"@path": …} binding';
      if (name === 'FunctionCall') return 'a {"@call": …} function call';
      const [t, dd] = resolve(s.$ref, doc, cat); return describe(t, dd, cat, d + 1);
    }
    if ('const' in s) return JSON.stringify(s.const);
    if (s.enum) return 'one of ' + s.enum.map(v => JSON.stringify(v)).join(', ');
    if (s.type) return [].concat(s.type).map(t => A[t] || t).join(' or ');
    if (s.oneOf || s.anyOf) return orList((s.oneOf || s.anyOf).map(x => describe(x, doc, cat, d + 1)));
    return 'something else';
  }

  /* constant values a schema pins for each property: used to find a oneOf's discriminator */
  const cCache = new WeakMap();
  function consts(s, doc, cat, d = 0) {
    const m = new Map();
    if (!s || typeof s !== 'object' || d > 8) return m;
    let per = cCache.get(s); if (per && per.has(cat)) return per.get(cat);
    const put = (k, vs) => { if (!m.has(k)) m.set(k, new Set()); for (const v of vs) m.get(k).add(v); };
    if (s.$ref) { const [t, dd] = resolve(s.$ref, doc, cat); for (const [k, vs] of consts(t, dd, cat, d + 1)) put(k, vs); }
    if (s.properties) for (const [k, ps] of Object.entries(s.properties)) if (ps && typeof ps === 'object' && 'const' in ps) put(k, [ps.const]);
    for (const sub of s.allOf || []) for (const [k, vs] of consts(sub, doc, cat, d + 1)) put(k, vs);
    for (const key of ['oneOf', 'anyOf']) if (s[key]) {
      const ms = s[key].map(sub => consts(sub, doc, cat, d + 1));
      for (const k of [...(ms[0] || new Map()).keys()].filter(k => ms.every(x => x.has(k)))) put(k, ms.flatMap(x => [...x.get(k)]));
    }
    if (!per) { per = new Map(); cCache.set(s, per); } per.set(cat, m);
    return m;
  }

  const depth = r => r.errs.reduce((a, e) => Math.max(a, e.ip.length), 0);
  const best = rs => rs.slice().sort((a, b) => depth(b) - depth(a) || a.errs.length - b.errs.length)[0];
  function addEv(R, ev) { if (R.ev === '*') return; if (ev === '*') { R.ev = '*'; return; } for (const k of ev) R.ev.add(k); }

  function oneOf(subs, x, doc, ip, cat) {
    let cand = subs.map((_, i) => i);
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const cs = subs.map(s => consts(s, doc, cat));
      for (const k of Object.keys(x)) {
        if (!cs.every(c => c.has(k))) continue;
        const all = [...new Set(cs.flatMap(c => [...c.get(k)]))];
        if (all.length < 2) continue;
        const hit = cand.filter(i => cs[i].get(k).has(x[k]));
        if (!hit.length) return { errs: [E(ip.concat(k), `${JSON.stringify(x[k])} is not a known ${k === 'component' ? 'component in this catalog' : k === '@call' ? 'function' : k}` +
          (all.length <= 24 ? ` — expected ${orList(all.map(v => String(v)))}` : ''), 'disc')], ev: '*' };
        cand = hit; break;
      }
    }
    const rs = cand.map(i => check(subs[i], x, doc, ip, cat));
    const ok = rs.filter(r => !r.errs.length);
    if (ok.length === 1) return ok[0];
    if (ok.length > 1) return { errs: [E(ip, 'matches more than one allowed shape', 'oneOf')], ev: ok[0].ev };
    const viable = rs.filter(r => !r.errs.some(e => (e.k === 'type' || e.k === 'notShape') && e.ip.length === ip.length));
    if (!viable.length) return { errs: [E(ip, `should be ${orList(cand.map(i => describe(subs[i], doc, cat)))}, not ${said(x)}`, 'type')], ev: '*' };
    return best(viable);
  }

  function check(s, x, doc, ip, cat) {
    const R = { errs: [], ev: new Set() };
    if (s === true || s === undefined || s === null) return R;
    if (s === false) { R.errs.push(E(ip, 'is not allowed here', 'false')); return R; }
    const errsOf = r => { for (const e of r.errs) R.errs.push(e); };
    const inPlace = r => { errsOf(r); addEv(R, r.ev); };
    if (s.$ref) { const [t, d] = resolve(s.$ref, doc, cat); if (t == null) R.errs.push(E(ip, 'schema reference not found: ' + s.$ref, 'internal')); else inPlace(check(t, x, d, ip, cat)); }
    if (s.type !== undefined) {
      const ts = [].concat(s.type);
      if (!ts.some(t => typeOk(t, x))) { R.errs.push(E(ip, `should be ${orList(ts.map(t => A[t] || t))}, not ${said(x)}`, 'type')); return R; }
    }
    if ('const' in s && !eq(s.const, x)) R.errs.push(E(ip, `should be ${JSON.stringify(s.const)}, not ${said(x)}`, 'const'));
    if (s.enum && !s.enum.some(v => eq(v, x))) R.errs.push(E(ip, `${said(x)} is not allowed — expected ${s.enum.length > 12 ? 'one of ' + s.enum.length + ' names in the catalog' : orList(s.enum.map(v => JSON.stringify(v)))}`, 'enum'));
    if (typeof x === 'string' && s.pattern && !re(s.pattern).test(x)) R.errs.push(E(ip, `${said(x)} does not match ${s.pattern}`, 'pattern'));
    if (typeof x === 'number') {
      if (s.minimum != null && x < s.minimum) R.errs.push(E(ip, `should be at least ${s.minimum}`, 'range'));
      if (s.maximum != null && x > s.maximum) R.errs.push(E(ip, `should be at most ${s.maximum}`, 'range'));
    }
    if (Array.isArray(x)) {
      if (s.minItems != null && x.length < s.minItems) R.errs.push(E(ip, `needs at least ${s.minItems} item${s.minItems > 1 ? 's' : ''}`, 'size'));
      if (s.maxItems != null && x.length > s.maxItems) R.errs.push(E(ip, `allows at most ${s.maxItems} items`, 'size'));
      if (s.uniqueItems && new Set(x.map(v => JSON.stringify(canon(v)))).size !== x.length) R.errs.push(E(ip, 'items must be unique', 'size'));
      if (s.items !== undefined) x.forEach((v, i) => errsOf(check(s.items, v, doc, ip.concat(i), cat)));
    }
    const isObj = x !== null && typeof x === 'object' && !Array.isArray(x);
    if (isObj) {
      const keys = Object.keys(x), covered = new Set();
      for (const k of s.required || []) if (!(k in x)) R.errs.push(E(ip, `missing required “${k}”`, 'required'));
      if (s.minProperties != null && keys.length < s.minProperties) R.errs.push(E(ip, `needs at least ${s.minProperties} propert${s.minProperties > 1 ? 'ies' : 'y'}`, 'size'));
      if (s.maxProperties != null && keys.length > s.maxProperties) R.errs.push(E(ip, `allows at most ${s.maxProperties} propert${s.maxProperties > 1 ? 'ies' : 'y'}`, 'size'));
      if (s.propertyNames !== undefined) for (const k of keys) if (check(s.propertyNames, k, doc, ip.concat(k), cat).errs.length)
        R.errs.push(E(ip.concat(k), `the key “${k}” is not allowed here${k.startsWith('@') ? ' (keys starting with @ are reserved)' : ''}`, 'propertyNames'));
      if (s.properties) for (const [k, ps] of Object.entries(s.properties)) if (k in x) { covered.add(k); R.ev.add(k); errsOf(check(ps, x[k], doc, ip.concat(k), cat)); }
      if (s.patternProperties) for (const [p, ps] of Object.entries(s.patternProperties)) for (const k of keys) if (re(p).test(k)) { covered.add(k); R.ev.add(k); errsOf(check(ps, x[k], doc, ip.concat(k), cat)); }
      if (s.additionalProperties !== undefined) for (const k of keys) if (!covered.has(k)) {
        R.ev.add(k);
        if (s.additionalProperties === false) R.errs.push(E(ip.concat(k), `unknown property “${k}”`, 'unknown'));
        else errsOf(check(s.additionalProperties, x[k], doc, ip.concat(k), cat));
      }
    }
    for (const sub of s.allOf || []) inPlace(check(sub, x, doc, ip, cat));
    if (s.anyOf) {
      const rs = s.anyOf.map(sub => check(sub, x, doc, ip, cat)), ok = rs.filter(r => !r.errs.length);
      if (ok.length) ok.forEach(r => addEv(R, r.ev)); else inPlace(best(rs));
    }
    if (s.oneOf) inPlace(oneOf(s.oneOf, x, doc, ip, cat));
    if (s.not !== undefined && !check(s.not, x, doc, ip, cat).errs.length) {
      const ns = s.not;
      R.errs.push(ns && 'const' in ns ? E(ip, `${JSON.stringify(ns.const)} is reserved here`, 'not')
        : E(ip, ns && ns.anyOf ? 'looks like a binding or a function call but is not a valid one' : 'has a shape that is not allowed here', 'notShape'));
    }
    if (s.if !== undefined) {
      const r = check(s.if, x, doc, ip, cat);
      if (!r.errs.length) { addEv(R, r.ev); if (s.then !== undefined) inPlace(check(s.then, x, doc, ip, cat)); }
      else if (s.else !== undefined) inPlace(check(s.else, x, doc, ip, cat));
    }
    if (s.unevaluatedProperties !== undefined && isObj && R.ev !== '*') {
      for (const k of Object.keys(x)) if (!R.ev.has(k)) {
        if (s.unevaluatedProperties === false) R.errs.push(E(ip.concat(k), `unknown property “${k}”`, 'unknown'));
        else errsOf(check(s.unevaluatedProperties, x[k], doc, ip.concat(k), cat));
      }
      R.ev = new Set(Object.keys(x));
    }
    return R;
  }

  /* where an error sits, for people: components are named by id */
  function where(msg, ip, from) {
    const out = []; let o = from;
    for (let i = 0; i < ip.length; i++) {
      const k = ip[i], parent = ip[i - 1];
      o = o == null ? o : o[k];
      if (typeof k === 'number' && parent === 'components') { out.pop(); out.push(o && typeof o.id === 'string' ? `“${o.id}”` + (typeof o.component === 'string' ? ` (${o.component})` : '') : `component #${k + 1}`); }
      else out.push(typeof k === 'number' ? `[${k}]` : k);
    }
    return out.join(' › ').replace(/ › \[/g, '[');
  }

  /* validate one agent→renderer message. catalogOf(surfaceId) says which catalog the surface uses.
     Returns [{text, ip, compId, k}] — empty when the message is valid. */
  function validate(msg, catalogOf) {
    if (!S()) return [];
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return [{ text: 'a message must be a JSON object', ip: [], k: 'type' }];
    const present = Object.keys(KEYS).filter(k => k in msg);
    if (present.length !== 1) return [];  /* the envelope error is reported by the caller */
    const key = present[0], body = msg[key] || {};
    const catId = key === 'createSurface' ? body.catalogId : catalogOf && catalogOf(body.surfaceId);
    const cat = catId === undefined || catId === BASIC ? S().basic : OPEN;
    const R = check({ $ref: '#/$defs/' + KEYS[key] + 'Message' }, msg, S().agent, [], cat);
    const seen = new Set(), out = [], disc = new Set(R.errs.filter(e => e.k === 'disc').map(e => e.ip.join('/')));
    for (const e of R.errs) {
      if (e.k === 'not' && disc.has(e.ip.join('/'))) continue;
      const w = where(msg, e.ip[0] === key ? e.ip.slice(1) : e.ip, e.ip[0] === key ? body : msg), text = (w ? w + ': ' : '') + e.msg;
      if (seen.has(text)) continue; seen.add(text);
      const ci = e.ip.indexOf('components'), comp = ci >= 0 && typeof e.ip[ci + 1] === 'number' ? body.components && body.components[e.ip[ci + 1]] : null;
      /* a component that names another catalog is not ours to judge */
      if (comp && typeof comp['@catalogId'] === 'string' && comp['@catalogId'] !== BASIC) continue;
      out.push({ text, ip: e.ip, compId: comp && typeof comp.id === 'string' ? comp.id : null, k: e.k });
    }
    return out;
  }
  const api = { validate, BASIC, customCatalog: id => id !== undefined && id !== BASIC };
  if (typeof module === 'object' && module.exports) module.exports = api; else G.A2UIValidate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
