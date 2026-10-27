// ป้าคีน: LINE income/expense bot + web app API, on Cloudflare Workers + D1.
// The web app itself is public/index.html, served as a static asset.
// Check: node test.mjs

const RED = '#C24A44', GREEN = '#35805A', GREY = '#6E6E73';
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const HELP = 'พิมพ์รายการได้เลยจ้ะ เช่น “กาแฟ 60” หรือ “เงินเดือน 30000” จะส่งรูปสลิป เสียง หรือ PDF ก็ได้\n'
  + 'ดูสรุป กราฟ และแก้ไขรายการได้จากเมนูด้านล่าง · พิมพ์ “ลบ” เพื่อลบรายการล่าสุด';
const FAIL = 'ขอโทษจ้ะ ป้าจดไม่สำเร็จ ลองใหม่อีกทีนะ';
const BUSY = 'ตอนนี้ AI คนใช้เยอะจ้ะ รอสักครู่แล้วส่งใหม่อีกทีนะ หรือกด + ในแอปเพื่อจดเองได้เลย';
const QUOTA = 'วันนี้ป้าใช้โควต้า AI ฟรีหมดแล้วจ้ะ ลองใหม่ทีหลัง หรือกด + ในแอปเพื่อจดเองได้เลย';
const DEFAULT_CATEGORIES = {
  expense: ['อาหาร', 'เครื่องดื่ม', 'ขนมหวาน', 'บันเทิง', 'ชอปปิ้ง', 'เดินทาง', 'ค่าน้ำค่าไฟ', 'เรียน', 'ของขวัญ', 'อื่นๆ'],
  income: ['เงินเดือน', 'อื่นๆ'],
};
const DEFAULT_SETTINGS = {
  memory: true, track_channel: false, confirm: 'card', remind: '', lang: 'th',
  currency: '฿', tz: 'Asia/Bangkok', cycle_day: 1, theme: 'auto',
};
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, picture TEXT, settings TEXT)',
  'CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, user_id TEXT, kind TEXT, name TEXT, sort INTEGER DEFAULT 0, budget REAL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT)',
  `CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY, user_id TEXT, ts TEXT, kind TEXT, amount REAL,
    category_id INTEGER, note TEXT DEFAULT '', channel_id INTEGER, memory INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS recurring (id INTEGER PRIMARY KEY, user_id TEXT, kind TEXT, amount REAL, category_id INTEGER,
    note TEXT DEFAULT '', channel_id INTEGER, freq TEXT, start TEXT, count INTEGER DEFAULT 0)`,
];
const ENTRY_SCHEMA = {
  type: 'OBJECT',
  properties: {entries: {type: 'ARRAY', items: {
    type: 'OBJECT',
    properties: {
      kind: {type: 'STRING', enum: ['expense', 'income']},
      amount: {type: 'NUMBER'},
      category: {type: 'STRING'},
      note: {type: 'STRING'},
      datetime: {type: 'STRING'},
      channel: {type: 'STRING'},
    },
    required: ['kind', 'amount', 'category', 'note'],
  }}},
  required: ['entries'],
};
const INSERT_ENTRY = 'INSERT INTO entries (user_id, ts, kind, amount, category_id, note, channel_id, memory)';

// ---------- storage ----------

let ready;  // schema is applied once per isolate
const init = env => ready ??= env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)))
  // ponytail: one-column migration retried per isolate; move to D1 migrations if the schema keeps changing
  .then(() => env.DB.prepare('ALTER TABLE categories ADD COLUMN color TEXT').run().catch(() => {}))
  // adding channels.type succeeds exactly once; that is when existing users get cash and the two default cards
  .then(() => env.DB.prepare('ALTER TABLE channels ADD COLUMN type TEXT').run().then(() => env.DB.batch([
    "UPDATE channels SET type = 'cash' WHERE name = 'เงินสด'",
    "INSERT INTO channels (user_id, name, type) SELECT id, 'เงินสด', 'cash' FROM users WHERE id NOT IN (SELECT user_id FROM channels WHERE type = 'cash')",
    "INSERT INTO channels (user_id, name, type) SELECT id, 'KTC', 'card' FROM users",
    "INSERT INTO channels (user_id, name, type) SELECT id, 'UOB', 'card' FROM users",
  ].map(sql => env.DB.prepare(sql))), () => {}))
  .catch(e => { ready = null; throw e; });
const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const all = async (env, sql, ...args) => (await q(env, sql, ...args).all()).results;
const settings = u => ({...DEFAULT_SETTINGS, ...JSON.parse(u.settings)});
async function saveSettings(env, u, patch) {
  u.settings = JSON.stringify({...JSON.parse(u.settings), ...patch});
  await q(env, 'UPDATE users SET settings = ? WHERE id = ?', u.settings, u.id).run();
}

async function getUser(env, uid, create) {
  const u = await q(env, 'SELECT * FROM users WHERE id = ?', uid).first();
  if (u || !create) return u;
  let profile = {};
  try { profile = await (await lineApi(env, '/v2/bot/profile/' + uid)).json(); } catch {}
  await env.DB.batch([
    q(env, "INSERT OR IGNORE INTO users VALUES (?, ?, ?, '{}')", uid, profile.displayName || '', profile.pictureUrl || ''),
    ...Object.entries(DEFAULT_CATEGORIES).flatMap(([kind, names]) => names.map((name, i) =>
      q(env, 'INSERT INTO categories (user_id, kind, name, sort) VALUES (?, ?, ?, ?)', uid, kind, name, i))),
    ...[['เงินสด', 'cash'], ['KTC', 'card'], ['UOB', 'card']].map(([name, type]) => q(env, 'INSERT INTO channels (user_id, name, type) VALUES (?, ?, ?)', uid, name, type)),
  ]);
  return getUser(env, uid);
}

// ---------- dates (plain 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM' strings in the user's own time zone) ----------

const D = s => new Date(s + 'T00:00:00Z'), iso = d => d.toISOString().slice(0, 10);
const validDate = s => { try { return typeof s === 'string' && iso(D(s)) === s; } catch { return false; } };
const validTs = s => typeof s === 'string' && /^\d{4}-\d\d-\d\d ([01]\d|2[0-3]):[0-5]\d$/.test(s) && validDate(s.slice(0, 10));

function localNow(s) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: s.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function addDays(s, n) { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function addMonths(s, k) {  // same day next month, clamped to the month's length
  const d = D(s), day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + k);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return iso(d);
}
const nthDue = (start, freq, k) => freq === 'monthly' ? addMonths(start, k) : addDays(start, k * (freq === 'weekly' ? 7 : 1));

// Create any recurring entries that have come due. Runs lazily whenever the user shows up.
async function applyRecurring(env, u) {
  const today = localNow(settings(u)).slice(0, 10), stmts = [];
  for (const r of await all(env, 'SELECT * FROM recurring WHERE user_id = ?', u.id)) {
    for (let k = r.count, due; (due = nthDue(r.start, r.freq, k)) <= today; k++) {
      // each occurrence is inserted only if the counter still says it is next, so two requests at once can't double it
      stmts.push(
        q(env, `${INSERT_ENTRY} SELECT ?, ?, ?, ?, ?, ?, ?, 0 WHERE (SELECT count FROM recurring WHERE id = ?) = ?`,
          u.id, due + ' 00:00', r.kind, r.amount, r.category_id, r.note, r.channel_id, r.id, k),
        q(env, 'UPDATE recurring SET count = ? WHERE id = ? AND count = ?', k + 1, r.id, k));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
}

// ---------- LINE + Gemini ----------

const enc = new TextEncoder();
const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, [usage]);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(/^([0-9a-f]{2})+$/.test(s) ? s.match(/../g) : [], h => parseInt(h, 16));

async function makeToken(env, uid, days = 30) {
  const payload = `${uid}.${Math.floor(Date.now() / 1000) + days * 86400}`;
  const key = await hmacKey('app-token' + env.LINE_CHANNEL_SECRET, 'sign');
  return payload + '.' + hex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}
async function checkToken(env, token) {
  const i = token.lastIndexOf('.'), payload = token.slice(0, i), j = payload.lastIndexOf('.');
  const uid = payload.slice(0, j), exp = payload.slice(j + 1);
  const key = await hmacKey('app-token' + env.LINE_CHANNEL_SECRET, 'verify');
  const ok = await crypto.subtle.verify('HMAC', key, unhex(token.slice(i + 1)), enc.encode(payload));
  return ok && /^\d+$/.test(exp) && +exp > Date.now() / 1000 ? uid : null;
}
// ponytail: signed 30-day link instead of LINE Login; switch to LIFF id-token verification if links get shared around
const appUrl = async (env, origin, uid, extra = '', days) => `${origin}/#t=${await makeToken(env, uid, days)}${extra}`;

async function validSignature(env, body, signature) {
  let sig;
  try { sig = Uint8Array.from(atob(signature), c => c.charCodeAt(0)); } catch { return false; }
  return crypto.subtle.verify('HMAC', await hmacKey(env.LINE_CHANNEL_SECRET, 'verify'), sig, body);
}

async function call(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${new URL(url).pathname}: ${(await r.text()).slice(0, 300)}`), {status: r.status});
  return r;
}
// the *_API overrides exist so test.mjs can point the worker at a local mock
const lineApi = (env, path, body, host = env.LINE_API || 'https://api.line.me') => call(host + path, {
  method: body ? 'POST' : 'GET',
  headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN},
  body: body && JSON.stringify(body),
});

// The tile menu under the chat. Each tile's position matches the artwork in public/menu.jpg (drawn from menu-source.svg).
// 'add' and 'tab:*' tiles open the web app, the others are answered in the chat.
const MENU_VERSION = 4;  // bump when the artwork or the tiles change, so every user's menu is rebuilt
const MENU_TILES = [[60, 60, 1380, 1000, 'add'], [1500, 60, 440, 470, 'tab:sum'], [2000, 60, 440, 470, 'tab:ana'], [1500, 590, 440, 470, 'tab:bud'],
  [2000, 590, 440, 470, 'tab:list'], [60, 1120, 1380, 506, 'sum'], [1500, 1120, 440, 506, 'tab:set'], [2000, 1120, 440, 506, 'help']];  // boxes from make-menu.py

// The app links carry a 45-day token, so each user's menu is rebuilt every 20 days, whenever they next talk to the bot.
async function ensureMenu(env, origin, u) {
  const s = settings(u), auth = {Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN};
  if (s.menu_v === MENU_VERSION && Date.now() - s.menu_at < 20 * 864e5) return;
  const app = await appUrl(env, origin, u.id, '', 45);
  const {richMenuId} = await (await lineApi(env, '/v2/bot/richmenu', {
    size: {width: 2500, height: 1686}, selected: true, name: 'paakeen', chatBarText: 'เมนูป้าคีน',
    areas: MENU_TILES.map(([x, y, width, height, does]) => ({bounds: {x, y, width, height}, action:
      does === 'add' ? {type: 'uri', uri: app + '&add=1'}
      : does.startsWith('tab:') ? {type: 'uri', uri: app + '&tab=' + does.slice(4)}
      : {type: 'postback', data: does, displayText: does === 'sum' ? 'สรุป' : 'วิธีใช้'}})),
  })).json();
  const image = await (await env.ASSETS.fetch(origin + '/menu.jpg')).arrayBuffer();
  await call(`${env.LINE_DATA_API || 'https://api-data.line.me'}/v2/bot/richmenu/${richMenuId}/content`, {method: 'POST', headers: {...auth, 'Content-Type': 'image/jpeg'}, body: image});
  await lineApi(env, `/v2/bot/user/${u.id}/richmenu/${richMenuId}`, {});
  if (s.menu_id) await call(`${env.LINE_API || 'https://api.line.me'}/v2/bot/richmenu/${s.menu_id}`, {method: 'DELETE', headers: auth}).catch(console.error);
  await saveSettings(env, u, {menu_at: Date.now(), menu_id: richMenuId, menu_v: MENU_VERSION, menu_origin: origin});
}

// Reading a receipt or a short message needs little reasoning, and thinking is most of a reply's wait. Gemini 3.x Flash
// models think at medium by default: ask for the least they allow; 2.5 takes a budget instead. A model that rejects
// the setting (400) is retried without it and remembered for this isolate.
const thinking = m => m.startsWith('gemini-2.5') ? {thinkingBudget: 0} : {thinkingLevel: m.includes('lite') ? 'minimal' : 'low'};
const noThinkingConfig = new Set();

async function gemini(env, parts, system) {
  const body = model => JSON.stringify({
    systemInstruction: {parts: [{text: system}]},
    contents: [{role: 'user', parts}],
    generationConfig: {responseMimeType: 'application/json', responseSchema: ENTRY_SCHEMA,
      ...(noThinkingConfig.has(model) ? {} : {thinkingConfig: thinking(model)})},
  });
  // Plain text is the easy case and goes to the fast list; photos, voice and PDFs go to the stronger one.
  const easy = parts.every(p => p.text !== undefined);
  const models = (easy ? env.GEMINI_FAST_MODEL || env.GEMINI_MODEL : env.GEMINI_MODEL).split(',').map(m => m.trim());
  const stop = new AbortController();  // once one model answers, the others are cancelled
  const ask = async model => {
    const go = () => call(`${env.GEMINI_API || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY}, body: body(model),
      signal: AbortSignal.any([stop.signal, AbortSignal.timeout(9000)]),
    });
    const t0 = Date.now();
    const r = await go().catch(e => {
      if (e.status !== 400 || noThinkingConfig.has(model)) throw e;
      noThinkingConfig.add(model);  // this model doesn't take the thinking setting: ask again without it
      return go();
    });
    const text = (await r.json()).candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
    console.log(JSON.stringify({gemini: model, ms: Date.now() - t0, media: !easy}));
    return JSON.parse(text).entries || [];
  };
  // Hedged: start the first model; if it hasn't answered after HEDGE ms, also start the next one, and so on.
  // A busy or retired model (503, 429, 404, or a hang) moves on straight away. The first answer wins.
  // ponytail: a slow model costs a second free-tier request; lower HEDGE only if replies are still slow
  const HEDGE = easy ? 3500 : 6000;
  return new Promise((resolve, reject) => {
    let started = 0, running = 0, done = false, error;
    const finish = (ok, v) => { if (done) return; done = true; stop.abort(); ok ? resolve(v) : reject(v); };
    const next = () => {
      if (done || started >= models.length) return;
      const model = models[started++], timer = setTimeout(next, HEDGE);
      running++;
      ask(model).then(v => finish(true, v), e => {
        if (e.name === 'TimeoutError' || e.name === 'AbortError') e.status = 503;  // a hung model counts as busy
        error = e;
        if (![404, 429, 503].includes(e.status)) return finish(false, e);
        clearTimeout(timer);
        next();
      }).finally(() => { clearTimeout(timer); if (--running === 0 && started >= models.length) finish(false, error); });
    };
    next();
  });
}

// The small models sometimes respell Thai (แซนวิสไส้กรอกไก้ came back as แกนวิสไสเกรอกไก). If the note isn't in what the
// user typed, use the closest stretch of their text instead (edit distance against every substring), unless it is
// too different to be a respelling, e.g. a deliberate shortening or translation.
function snap(note, text) {
  note = note.trim();
  if (!note || text.includes(note)) return note;
  const a = [...note], b = [...text];
  let d = b.map(() => 0).concat(0), start = d.map((_, j) => j);  // row 0: an empty note matches anywhere for free
  for (let i = 1; i <= a.length; i++) {
    const nd = [i], ns = [0];
    for (let j = 1; j <= b.length; j++) {
      const opts = [[d[j - 1] + (a[i - 1] !== b[j - 1]), start[j - 1]], [d[j] + 1, start[j]], [nd[j - 1] + 1, ns[j - 1]]];
      [nd[j], ns[j]] = opts.reduce((x, y) => (y[0] < x[0] ? y : x));
    }
    d = nd; start = ns;
  }
  const dist = Math.min(...d), mark = c => /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c ?? '');
  let i = start[d.indexOf(dist)], j = d.indexOf(dist);
  while (mark(b[j])) j++;  // a Thai vowel or tone mark belongs to the letter before it
  while (i > 0 && mark(b[i])) i--;
  const best = b.slice(i, j).join('').trim();
  return best && dist <= a.length * 0.4 ? best : note;
}

// Ask the model for entries, validate them, save them. Returns the saved entries.
async function record(env, u, parts) {
  const s = settings(u), now = localNow(s);
  const cats = await all(env, 'SELECT * FROM categories WHERE user_id = ? ORDER BY sort, id', u.id);
  const chans = s.track_channel ? await all(env, 'SELECT * FROM channels WHERE user_id = ?', u.id) : [];
  const names = kind => cats.filter(c => c.kind === kind).map(c => c.name).join(', ');
  const system = 'Extract income/expense entries from the user\'s message, photo, voice note or PDF (Thai or English). '
    + 'One entry per item; amount is a positive number. `note` is a short label for the item or shop. '
    + `\`category\` must be one of these. Expense: ${names('expense')}. Income: ${names('income')}. `
    + `\`datetime\` is 'YYYY-MM-DD HH:MM' only if the source says when it happened, otherwise ''. Now is ${now}. `
    + (chans.length ? `\`channel\` is how it was paid, one of: ${chans.map(c => c.name).join(', ')}; '' if not stated. ` : '')
    + 'Copy `note` from the user\'s own words exactly, keeping their spelling and every Thai vowel and tone mark; never correct, respell or translate it. '
    + 'If there is no amount of money, return an empty list.';
  const saved = [], typed = parts.every(p => p.text !== undefined) && parts.map(p => p.text).join('\n');
  for (const e of await gemini(env, parts, system)) {
    const amount = Math.round(Number(e?.amount) * 100) / 100, kind = e?.kind, note = (typed ? snap(String(e?.note ?? ''), typed) : String(e?.note ?? '')).slice(0, 100);
    if (!['expense', 'income'].includes(kind) || !(amount > 0 && amount < 1e12)) continue;
    const mine = cats.filter(c => c.kind === kind);
    let cat = mine.find(c => c.name === e.category) || mine.at(-1), memory = 0;
    if (s.memory) {
      const seen = await q(env, 'SELECT category_id FROM entries WHERE user_id = ? AND kind = ? AND note = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1', u.id, kind, note).first();
      const remembered = seen && mine.find(c => c.id === seen.category_id);
      if (remembered) [cat, memory] = [remembered, 1];
    }
    const ts = validTs(e.datetime) ? e.datetime : now;
    const chan = chans.find(c => c.name === e.channel);
    const {meta} = await q(env, `${INSERT_ENTRY} VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      u.id, ts, kind, amount, cat?.id ?? null, note, chan?.id ?? null, memory).run();
    const colour = cat ? cat.color || (kind === 'income' ? INCOME_COLOUR : PAL[cats.filter(c => c.kind === 'expense').indexOf(cat) % PAL.length]) : '#A9A9B0';
    saved.push({id: meta.last_row_id, ts, kind, amount, note, memory, colour, category: cat?.name ?? 'อื่นๆ', channel: chan?.name ?? ''});
  }
  return saved;
}

// ---------- LINE messages ----------

const money = (s, n) => (n < 0 ? '-' : '') + s.currency + Math.abs(n).toLocaleString('en-US', {maximumFractionDigits: 2});
const thaiDt = ts => `${+ts.slice(8, 10)} ${TH_MONTHS[ts.slice(5, 7) - 1]} ${+ts.slice(0, 4) + 543} ${ts.slice(11)}`;
const textMsg = text => ({type: 'text', text});
const T = (text, opts = {}) => ({type: 'text', text: text || '-', wrap: true, ...opts});
const bubble = (title, sub, body, actions) => ({
  type: 'bubble',
  header: {type: 'box', layout: 'vertical', backgroundColor: '#FDECEA', contents: [T(title, {weight: 'bold', size: 'lg'}), T(sub, {size: 'xs', color: GREY})]},
  body: {type: 'box', layout: 'vertical', spacing: 'sm', contents: body},
  footer: {type: 'box', layout: 'horizontal', spacing: 'sm', contents: actions.map(action => ({type: 'button', style: 'secondary', height: 'sm', action}))},
});
const flex = (alt, bubbles) => ({type: 'flex', altText: alt.slice(0, 400), contents: bubbles.length === 1 ? bubbles[0] : {type: 'carousel', contents: bubbles.slice(0, 12)}});

// same as public/index.html: expense-category colours: the soft set, without green (green means รายรับ); a category uses its own choice, else the next
const PAL = ['#E58C84', '#E8AC72', '#DDC46A', '#7FC4BD', '#86B2DE', '#9F9DDA', '#C3A0D8', '#E39AB4', '#BBA38C', '#92C1D1', '#A9A9B0'];
const INCOME_COLOUR = '#35805A';  // income categories use the same green as รายรับ in สรุป

// The "saved" card, styled like the web app: soft tinted background, white capsules, the category's own colour.
function savedCard(s, e, editUrl) {
  const out = e.kind === 'expense', colour = out ? RED : GREEN, ink = '#1C1C1E';
  const pill = (label, textColour, bg, action) => ({type: 'box', layout: 'vertical', flex: 1, cornerRadius: 'xxl', backgroundColor: bg,
    borderWidth: '1px', borderColor: '#FFFFFFCC', paddingTop: '10px', paddingBottom: '10px', action,
    contents: [{type: 'text', text: label, size: 'sm', weight: 'bold', color: textColour, align: 'center'}]});
  const details = [e.category, e.channel, e.memory ? 'จำจากครั้งก่อน' : ''].filter(Boolean).join(' · ');
  return {
    type: 'bubble', size: 'kilo',
    styles: {body: {backgroundColor: '#F7F5F9'}},  // side-by-side cards are stretched to the tallest; keep the stretch off-white
    body: {type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px',
      background: {type: 'linearGradient', angle: '160deg', startColor: out ? '#FBE6E3' : '#E4F1E7', endColor: '#F7F5F9'},
      contents: [
        {type: 'box', layout: 'horizontal', alignItems: 'center', contents: [
          {type: 'box', layout: 'vertical', flex: 0, cornerRadius: 'xxl', backgroundColor: '#FFFFFFCC', paddingStart: '10px', paddingEnd: '10px', paddingTop: '4px', paddingBottom: '4px',
            contents: [{type: 'text', text: out ? '✓ จดรายจ่ายแล้ว' : '✓ จดรายรับแล้ว', size: 'xxs', weight: 'bold', color: colour}]},
          T(thaiDt(e.ts), {size: 'xxs', color: GREY, align: 'end'}),
        ]},
        {type: 'box', layout: 'vertical', spacing: 'xs', contents: [
          T(e.note || e.category, {size: 'lg', weight: 'bold', color: ink}),
          {type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center', contents: [
            {type: 'box', layout: 'vertical', width: '10px', height: '10px', cornerRadius: '5px', backgroundColor: e.colour || '#A9A9B0', contents: []},
            T(details, {size: 'xs', color: GREY, flex: 1}),
          ]},
        ]},
        T(`${out ? '-' : '+'}${money(s, e.amount)}`, {size: '3xl', weight: 'bold', color: colour}),
        {type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', contents: [
          pill('แก้ไข', ink, '#FFFFFFD9', {type: 'uri', label: 'แก้ไข', uri: editUrl}),
          pill('ลบ', RED, '#F6DCD9', {type: 'postback', label: 'ลบ', data: `del:${e.id}`, displayText: 'ลบรายการนี้'}),
        ]},
      ]},
  };
}

async function confirm(env, origin, u, saved, skipChannels) {
  const s = settings(u), colour = e => e.kind === 'expense' ? RED : GREEN;
  const line = e => `${e.kind === 'expense' ? '-' : '+'}${money(s, e.amount)} ${e.note} (${e.category})`;
  const msgs = [s.confirm === 'text'
    ? textMsg('จดแล้วจ้ะ\n' + saved.map(line).join('\n'))
    : flex('จดสำเร็จ: ' + saved.map(line).join(', '), await Promise.all(saved.map(async e => savedCard(s, e,
      await appUrl(env, origin, u.id, `&edit=${e.id}`)))))];
  const chans = s.track_channel && !skipChannels ? await all(env, 'SELECT * FROM channels WHERE user_id = ?', u.id) : [];
  const unknown = saved.filter(e => !e.channel && e.kind === 'expense').map(e => e.id).join(',');  // income never has a payment channel
  if (chans.length && unknown) {
    msgs.push({...textMsg('จ่ายด้วยช่องทางไหนจ๊ะ?'), quickReply: {items: [...chans.map(c => ({
      type: 'action', action: {type: 'postback', label: c.name.slice(0, 20), data: `ch:${unknown}:${c.id}`.slice(0, 300), displayText: c.name},
    })), skipButton(unknown)]}});
  }
  return msgs;
}

async function summaryMsg(env, origin, u) {
  const s = settings(u), today = localNow(s).slice(0, 10), m0 = today.slice(0, 8) + '01';
  // the cycle starts on cycle_day, clamped to the month's length (day 31 in a 30-day month starts on the 30th)
  const daysIn = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
  const startIn = m => m.slice(0, 8) + String(Math.min(s.cycle_day, daysIn(m))).padStart(2, '0');
  const start = today >= startIn(m0) ? startIn(m0) : startIn(addMonths(m0, -1));
  const rows = await all(env, `SELECT e.kind, COALESCE(c.name, 'อื่นๆ') AS name, SUM(e.amount) AS total FROM entries e
    LEFT JOIN categories c ON c.id = e.category_id WHERE e.user_id = ? AND e.ts >= ? GROUP BY e.kind, name ORDER BY total DESC`, u.id, start);
  const total = kind => rows.filter(r => r.kind === kind).reduce((a, r) => a + r.total, 0);
  const left = total('income') - total('expense');
  const body = [
    T(`รายรับ ${money(s, total('income'))}`, {color: GREEN}),
    T(`รายจ่าย ${money(s, total('expense'))}`, {color: RED}),
    T(`เหลือเก็บ ${money(s, left)}`, {weight: 'bold'}),
    ...rows.filter(r => r.kind === 'expense').slice(0, 10).map(r => T(`• ${r.name} ${money(s, r.total)}`, {size: 'sm', color: GREY})),
  ];
  return flex(`สรุปรอบนี้ เหลือเก็บ ${money(s, left)}`, [bubble('สรุปรอบนี้', `ตั้งแต่ ${+start.slice(8)} ${TH_MONTHS[start.slice(5, 7) - 1]}`, body,
    [{type: 'uri', label: 'เปิดแอป', uri: await appUrl(env, origin, u.id)}])]);
}

// ---------- slip follow-up: ask the name, file it by that name, then show the saved card ----------

const pendingOf = u => { const p = settings(u).pending; return p && p.until > Date.now() ? p : null; };
const skip = data => ({type: 'action', action: {type: 'postback', label: 'ข้าม', data: data.slice(0, 300), displayText: 'ข้าม'}});

// the last quick-reply button on a channel question: leave the channel unset
const skipButton = ids => skip(`chskip:${ids}`);

// The saved card for one entry as it is now in the database.
async function entryCard(env, origin, u, id) {
  const e = await q(env, `SELECT e.*, c.name AS category, c.color, c.kind AS ckind, ch.name AS channel FROM entries e
    LEFT JOIN categories c ON c.id = e.category_id LEFT JOIN channels ch ON ch.id = e.channel_id WHERE e.id = ? AND e.user_id = ?`, id, u.id).first();
  if (!e) return textMsg('ไม่พบรายการนี้แล้วจ้ะ');
  const expenseCats = await all(env, "SELECT id FROM categories WHERE user_id = ? AND kind = 'expense' ORDER BY sort, id", u.id);
  const i = expenseCats.findIndex(c => c.id === e.category_id);
  e.colour = e.color || (e.ckind === 'income' ? INCOME_COLOUR : i >= 0 ? PAL[i % PAL.length] : '#A9A9B0');
  e.category ??= 'อื่นๆ';
  const s = settings(u);
  return flex(`จด${e.kind === 'expense' ? 'รายจ่าย' : 'รายรับ'}แล้ว: ${e.note} ${money(s, e.amount)}`, [savedCard(s, e, await appUrl(env, origin, u.id, `&edit=${id}`))]);
}

// Ask the pending slip's name, or once it is named (or skipped), close the follow-up and show the saved card.
async function nextStep(env, origin, u, done) {
  const p = {...settings(u).pending, ...done}, id = p.ids[0];
  await saveSettings(env, u, {pending: p.named ? null : p});
  if (!p.named) return {...textMsg('สลิปนี้คือรายการอะไรจ๊ะ? พิมพ์ชื่อรายการมาได้เลย'), quickReply: {items: [skip(`nameskip:${id}`)]}};
  return entryCard(env, origin, u, id);
}

// File a named slip by its name: a name used before keeps that category (when memory is on), otherwise the fast model
// picks one. If neither gives an answer, the category guessed from the slip itself stays.
async function categoriseByName(env, u, id, name) {
  const e = await q(env, 'SELECT kind FROM entries WHERE id = ? AND user_id = ?', id, u.id).first();
  if (!e) return;
  const cats = await all(env, 'SELECT id, name FROM categories WHERE user_id = ? AND kind = ? ORDER BY sort, id', u.id, e.kind);
  const seen = settings(u).memory && await q(env, 'SELECT category_id FROM entries WHERE user_id = ? AND kind = ? AND note = ? COLLATE NOCASE AND id != ? ORDER BY id DESC LIMIT 1',
    u.id, e.kind, name, id).first();
  let cat = cats.find(c => c.id === seen?.category_id), memory = cat ? 1 : 0;
  if (!cat) {
    const [guess] = await gemini(env, [{text: name}], `The user names one ${e.kind === 'expense' ? 'expense' : 'income'} item (Thai or English). `
      + `Return exactly one entry: kind '${e.kind}', amount 1, note the name as given, and the category that fits it best, one of: ${cats.map(c => c.name).join(', ')}.`)
      .catch(err => { console.error(err); return []; });
    cat = cats.find(c => c.name === guess?.category);
  }
  if (cat) await q(env, 'UPDATE entries SET category_id = ?, memory = ? WHERE id = ? AND user_id = ?', cat.id, memory, id, u.id).run();
}

// A tapped button. Returns the reply: plain text, or a whole message when the slip follow-up continues.
async function postback(env, origin, u, data) {
  const [action, a, b] = data.split(':'), slip = pendingOf(u), mine = slip && a === String(slip.ids[0]);
  if (action === 'del' && /^\d+$/.test(a)) {
    const {meta} = await q(env, 'DELETE FROM entries WHERE id = ? AND user_id = ?', +a, u.id).run();
    if (mine) await saveSettings(env, u, {pending: null});
    return meta.changes ? 'ลบแล้วจ้ะ' : 'ไม่พบรายการนี้แล้วจ้ะ';
  }
  if (action === 'nameskip' && mine) return nextStep(env, origin, u, {named: true});
  if (action === 'chskip' && /^\d+(,\d+)*$/.test(a)) return 'ได้จ้ะ ไม่ระบุช่องทางนะ';
  if (action === 'ch' && /^\d+(,\d+)*$/.test(a) && /^\d+$/.test(b)) {
    const chan = await q(env, 'SELECT name FROM channels WHERE id = ? AND user_id = ?', +b, u.id).first();
    if (chan) {
      await env.DB.batch(a.split(',').map(id => q(env, 'UPDATE entries SET channel_id = ? WHERE id = ? AND user_id = ?', +b, +id, u.id)));
      return `จดช่องทาง ${chan.name} แล้วจ้ะ`;
    }
  }
  return HELP;
}

function toBase64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// One LINE webhook event in, a list of LINE messages out.
// later: work that can wait until the reply has been sent; the webhook runs it afterwards, one at a time, so nothing
// here writes the user's settings at the same moment as the reply's own steps
async function handleEvent(env, origin, ev, later = []) {
  const m = ev.message, t0 = Date.now();
  const media = ev.type === 'message' && (['image', 'audio'].includes(m.type) || (m.type === 'file' && (m.fileName || '').toLowerCase().endsWith('.pdf')));
  // a slip, voice note or PDF starts downloading straight away, alongside the user lookup
  const download = media ? lineApi(env, `/v2/bot/message/${m.id}/content`, null, env.LINE_DATA_API || 'https://api-data.line.me') : null;
  download?.catch(() => {});  // handled where it's awaited
  const u = await getUser(env, ev.source.userId, true);
  await applyRecurring(env, u);
  later.push(() => ensureMenu(env, origin, u));
  if (ev.type === 'follow') return [textMsg('สวัสดีจ้ะหลาน ป้าคีนจะช่วยจดรายรับรายจ่ายให้เอง\n' + HELP)];
  if (ev.type === 'postback') {
    if (ev.postback.data === 'sum') return [await summaryMsg(env, origin, u)];
    const reply = await postback(env, origin, u, ev.postback.data);
    return [typeof reply === 'string' ? textMsg(reply) : reply];
  }
  if (ev.type !== 'message') return [];
  let parts;
  if (m.type === 'text') {
    const text = m.text.trim();
    if (text.startsWith('สรุป')) return [await summaryMsg(env, origin, u)];
    if (text === 'แอป' || text === 'เปิดแอป') {
      return [flex('เปิดแอปป้าคีน', [bubble('ป้าคีน', 'ดูสรุป กราฟ งบ และแก้ไขรายการ', [T('ลิงก์นี้เป็นของหลานคนเดียว อย่าส่งต่อให้ใครนะจ๊ะ', {size: 'sm'})],
        [{type: 'uri', label: 'เปิดแอป', uri: await appUrl(env, origin, u.id)}])])];
    }
    if (text === 'ลบ') {
      const last = await q(env, 'SELECT id FROM entries WHERE user_id = ? ORDER BY id DESC LIMIT 1', u.id).first();
      return [textMsg(last ? await postback(env, origin, u, `del:${last.id}`) : 'ไม่มีรายการให้ลบจ้ะ')];
    }
    // right after a slip, the next message is its name
    const slip = pendingOf(u);
    if (slip && !slip.named) {
      await env.DB.batch(slip.ids.map(id => q(env, 'UPDATE entries SET note = ? WHERE id = ? AND user_id = ?', text.slice(0, 100), id, u.id)));
      await categoriseByName(env, u, slip.ids[0], text.slice(0, 100));
      return [await nextStep(env, origin, u, {named: true})];
    }
    parts = [{text}];
  } else if (media) {
    const r = await download;
    const bytes = new Uint8Array(await r.arrayBuffer());
    console.log(JSON.stringify({downloaded: m.type, kb: Math.round(bytes.length / 1024), ms: Date.now() - t0}));
    // ponytail: inline upload, capped for the free plan's CPU limit; use Gemini's Files API if bigger files matter
    if (bytes.length > 4_000_000) return [textMsg('ไฟล์ใหญ่เกินไปจ้ะ ส่งไฟล์ที่เล็กกว่า 4 MB นะ')];
    const mime = {audio: 'audio/mp4', file: 'application/pdf'}[m.type] || (r.headers.get('Content-Type') || 'image/jpeg').split(';')[0];
    parts = [{inline_data: {mime_type: mime, data: toBase64(bytes)}}, {text: 'จดรายการจากไฟล์นี้'}];
  } else {
    return [textMsg(HELP)];
  }
  const saved = await record(env, u, parts);
  console.log(JSON.stringify({recorded: m.type, entries: saved.length, ms: Date.now() - t0}));
  if (m.type === 'image' && saved.length === 1) {  // a slip: paid in cash; ask the name, then the category, then show the card
    const e = saved[0];
    let cash = e.kind === 'expense' && await q(env, "SELECT id FROM channels WHERE user_id = ? AND type = 'cash' ORDER BY id LIMIT 1", u.id).first();
    if (e.kind === 'expense' && !cash) cash = {id: (await q(env, "INSERT INTO channels (user_id, name, type) VALUES (?, 'เงินสด', 'cash')", u.id).run()).meta.last_row_id};
    await q(env, 'UPDATE entries SET channel_id = ? WHERE id = ? AND user_id = ?', cash ? cash.id : null, e.id, u.id).run();
    await saveSettings(env, u, {pending: {ids: [e.id], until: Date.now() + 10 * 60e3}});
    return [await nextStep(env, origin, u, {})];
  }
  return saved.length ? confirm(env, origin, u, saved) : [textMsg(HELP)];
}

async function webhook(request, env, ctx) {
  const body = await request.arrayBuffer();
  if (!await validSignature(env, body, request.headers.get('X-Line-Signature') || '')) return new Response(null, {status: 403});
  const origin = new URL(request.url).origin;
  // answer LINE first; the model call can take a few seconds (the platform allows ~30s of work after the response)
  ctx.waitUntil((async () => {
    for (const ev of JSON.parse(new TextDecoder().decode(body)).events || []) {
      if (ev.source?.type !== 'user') continue;  // 1:1 chats only, never read group conversations
      try {
        const dots = ev.type === 'message' ? lineApi(env, '/v2/bot/chat/loading/start', {chatId: ev.source.userId, loadingSeconds: 20}).catch(() => {}) : null;
        let msgs;
        const later = [];
        try {
          msgs = await handleEvent(env, origin, ev, later);
        } catch (e) {
          console.error(e);
          msgs = [textMsg(e.status === 429 ? QUOTA : e.status === 503 ? BUSY : FAIL)];
        }
        await dots;
        if (msgs.length && ev.replyToken) {
          await lineApi(env, '/v2/bot/message/reply', {replyToken: ev.replyToken, messages: msgs.slice(0, 5)}).catch(async e => {
            // LINE rejected the layout: still answer, as plain text built from each message's summary
            if (e.status !== 400) throw e;
            console.error(e);
            await lineApi(env, '/v2/bot/message/reply', {replyToken: ev.replyToken, messages: [textMsg(msgs.map(m => m.altText || m.text).join('\n'))]});
          });
        }
        for (const job of later) await job().catch(console.error);
      } catch (e) {
        console.error(e);
      }
    }
  })());
  return new Response(null, {status: 200});
}

async function remind(env) {
  for (const u of await all(env, 'SELECT * FROM users')) {
    // a new menu version reaches every user within one run, without waiting for them to message the bot
    const origin = settings(u).menu_origin || env.APP_ORIGIN;
    if (origin) await ensureMenu(env, origin, u).catch(console.error);
    const s = settings(u), now = localNow(s), today = now.slice(0, 10);
    if (!s.remind || now.slice(11) < s.remind || s.last_remind === today) continue;
    await q(env, 'UPDATE users SET settings = ? WHERE id = ?', JSON.stringify({...JSON.parse(u.settings), last_remind: today}), u.id).run();
    if (!await q(env, 'SELECT 1 FROM entries WHERE user_id = ? AND ts LIKE ?', u.id, today + '%').first()) {
      await lineApi(env, '/v2/bot/message/push', {to: u.id, messages: [textMsg('วันนี้จดรายรับรายจ่ายหรือยังจ๊ะหลาน พิมพ์มาบอกป้าได้เลย')]}).catch(console.error);
    }
  }
}

// ---------- web app API ----------

class Bad extends Error {}
const need = ok => { if (!ok) throw new Bad(); };
const num = v => { need(['number', 'string'].includes(typeof v) && v !== ''); return Math.round(Number(v) * 100) / 100; };
const vAmount = v => { v = num(v); need(v > 0 && v < 1e12); return v; };
const vChoice = (...options) => v => { need(options.includes(v)); return v; };
const vName = v => { need(typeof v === 'string' && v.trim()); return v.trim().slice(0, 40); };
const vNote = v => String(v ?? '').trim().slice(0, 100);
const vInt = v => { v = Number(v); need(Number.isInteger(v)); return v; };
const vId = v => v == null || v === '' ? null : vInt(v);
const vTs = v => { need(validTs(v)); return v; };
// the lower bound caps the catch-up loop in applyRecurring
const vStart = v => { need(validDate(v) && v >= addDays(iso(new Date()), -366)); return v; };
const vBool = v => { need(typeof v === 'boolean'); return v; };
const vDay = v => { v = vInt(v); need(v >= 1 && v <= 31); return v; };
const vTz = v => { try { new Intl.DateTimeFormat('en-US', {timeZone: v}); } catch { need(false); } need(typeof v === 'string'); return v; };
const vRemind = v => { need(v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v)); return v; };

const vColor = v => { need(typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)); return v; };
const vKind = vChoice('expense', 'income');
const ENTRY = {kind: vKind, amount: vAmount, category_id: vId, note: vNote, channel_id: vId};
// table -> [writable columns and their validators, columns required on insert]
const TABLES = {
  entries: [{...ENTRY, ts: vTs}, ['ts', 'kind', 'amount']],
  categories: [{kind: vKind, name: vName, sort: vInt, color: vColor}, ['kind', 'name']],
  channels: [{name: vName, type: vChoice('cash', 'card', 'other')}, ['name']],
  recurring: [{...ENTRY, freq: vChoice('daily', 'weekly', 'monthly'), start: vStart}, ['kind', 'amount', 'freq', 'start']],
};
const SETTINGS = {
  memory: vBool, track_channel: vBool, theme: vChoice('auto', 'light', 'dark'), confirm: vChoice('card', 'text'), remind: vRemind, lang: vChoice('th', 'en'),
  currency: v => vName(v).slice(0, 3), tz: vTz, cycle_day: vDay,
};
const validated = (rules, body) => Object.fromEntries(Object.entries(body).filter(([k]) => Object.hasOwn(rules, k)).map(([k, v]) => [k, rules[k](v)]));

// The whole web API. Throws Bad on a bad request.
async function api(env, u, method, path, body) {
  need(body && typeof body === 'object' && !Array.isArray(body));
  const uid = u.id;
  if (method === 'GET' && path.join('/') === 'state') {
    await applyRecurring(env, u);
    const rows = (table, order = 'id') => q(env, `SELECT * FROM ${table} WHERE user_id = ? ORDER BY ${order}`, uid);
    // ponytail: ships every entry and the browser does the maths; paginate once a user passes ~20k rows
    const [categories, channels, recurring, entries] = (await env.DB.batch(
      [rows('categories', 'sort, id'), rows('channels'), rows('recurring'), rows('entries', 'ts DESC, id DESC')])).map(r => r.results);
    return {user: {name: u.name, picture: u.picture}, settings: settings(u), categories, channels, recurring, entries};
  }
  if (method === 'PUT' && path.join('/') === 'settings') {
    await q(env, 'UPDATE users SET settings = ? WHERE id = ?', JSON.stringify({...JSON.parse(u.settings), ...validated(SETTINGS, body)}), uid).run();
    return {};
  }
  const [table, id, ...extra] = path;
  need(Object.hasOwn(TABLES, table) && !extra.length);
  const [columns, required] = TABLES[table];
  const vals = validated(columns, body), keys = Object.keys(vals);
  if (method === 'POST' && id === undefined) {
    need(required.every(k => k in vals));
    if (table === 'channels') need((await q(env, 'SELECT COUNT(*) AS n FROM channels WHERE user_id = ?', uid).first()).n < 10);
    const {meta} = await q(env, `INSERT INTO ${table} (user_id, ${keys.join(', ')}) VALUES (?${', ?'.repeat(keys.length)})`, uid, ...Object.values(vals)).run();
    return {id: meta.last_row_id};
  }
  if (method === 'PUT' && id !== undefined && keys.length) {
    await q(env, `UPDATE ${table} SET ${keys.map(k => k + ' = ?').join(', ')} WHERE id = ? AND user_id = ?`, ...Object.values(vals), vInt(id), uid).run();
    return {};
  }
  if (method === 'DELETE' && id !== undefined) {
    await q(env, `DELETE FROM ${table} WHERE id = ? AND user_id = ?`, vInt(id), uid).run();
    return {};
  }
  if (method === 'DELETE' && table === 'entries') {
    await q(env, 'DELETE FROM entries WHERE user_id = ?', uid).run();
    return {};
  }
  need(false);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // without the secrets, signatures and app links would be signed with a guessable key
    if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN || !env.GEMINI_API_KEY) return new Response('secrets not set', {status: 503});
    await init(env);
    if (request.method === 'POST' && url.pathname === '/webhook') return webhook(request, env, ctx);
    if (!url.pathname.startsWith('/api/')) return new Response('not found', {status: 404});
    const uid = await checkToken(env, (request.headers.get('Authorization') || '').replace(/^Bearer /, ''));
    const u = uid && await getUser(env, uid);
    if (!u) return new Response(null, {status: 401});
    // opening the app also refreshes the chat menu, so it does not depend on the user sending a message
    if (url.pathname === '/api/state') ctx.waitUntil(ensureMenu(env, url.origin, {...u}).catch(console.error));
    try {
      const text = await request.text();
      need(text.length < 1_000_000);
      return Response.json(await api(env, u, request.method, url.pathname.slice(5).split('/'), text ? JSON.parse(text) : {}));
    } catch (e) {
      if (e instanceof Bad || e instanceof SyntaxError) return new Response(null, {status: 400});
      throw e;
    }
  },

  async scheduled(event, env, ctx) {
    await init(env);
    ctx.waitUntil(remind(env));
  },
};
