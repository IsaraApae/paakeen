// End-to-end check: runs the worker locally against a mock LINE + Gemini.
//   node test.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const MOCK = 8798, PORT = 8799, base = `http://127.0.0.1:${PORT}`, mockUrl = `http://127.0.0.1:${MOCK}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let entries = [], geminiParts, geminiModel, geminiThinking, loadings = 0;
const replies = [], pushes = [], menus = [];

const mock = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = o => res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(o));
  if (req.url.includes('/profile/')) return json({displayName: 'Dev'});
  if (req.url.endsWith('/richmenu')) { menus.push(JSON.parse(body)); return json({richMenuId: 'rm' + menus.length}); }
  if (req.url.includes('/richmenu/')) return json({});
  if (req.url.endsWith('/reply')) { replies.push(JSON.parse(body).messages); return json({}); }
  if (req.url.endsWith('/loading/start')) { loadings++; return json({}); }
  if (req.url.endsWith('/push')) { pushes.push(JSON.parse(body)); return json({}); }
  if (req.url.endsWith('/content')) return res.writeHead(200, {'Content-Type': 'image/jpeg'}).end(Buffer.from([1, 2, 3]));
  if (req.url.includes('busy-model')) return res.writeHead(503).end('overloaded');  // forces the fallback model
  if (req.url.includes('slow-model')) { await sleep(8000); return res.writeHead(503).end('too late'); }  // hangs: the next model is started alongside
  if (req.url.includes(':generateContent')) {
    const {contents, generationConfig} = JSON.parse(body);
    // ok-model stands in for a model that doesn't accept the thinking setting
    if (req.url.includes('ok-model') && generationConfig.thinkingConfig) return res.writeHead(400).end('thinking not supported');
    geminiParts = contents[0].parts;
    geminiModel = req.url.split('/models/')[1].split(':')[0];
    geminiThinking = generationConfig.thinkingConfig;
    return json({candidates: [{content: {parts: [{text: JSON.stringify({entries})}]}}]});
  }
  res.writeHead(404).end();
}).listen(MOCK);

const vars = {LINE_CHANNEL_SECRET: 'dev', LINE_CHANNEL_ACCESS_TOKEN: 'dev', GEMINI_API_KEY: 'dev', LINE_API: mockUrl, LINE_DATA_API: mockUrl, GEMINI_API: mockUrl, GEMINI_MODEL: 'busy-model,slow-model,ok-model', GEMINI_FAST_MODEL: 'fast-model'};
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--test-scheduled', '--persist-to', mkdtempSync(join(tmpdir(), 'paakeen-')),
  ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], {stdio: process.env.DEBUG ? 'inherit' : 'ignore'});

async function hook(ev, uid = 'u1', secret = 'dev') {
  const body = JSON.stringify({events: [{replyToken: 'r', source: {type: 'user', userId: uid}, ...ev}]}), n = replies.length;
  const r = await fetch(base + '/webhook', {method: 'POST', body, headers: {'X-Line-Signature': createHmac('sha256', secret).update(body).digest('base64')}});
  if (r.status !== 200) return r.status;
  for (let i = 0; i < 100 && replies.length === n; i++) await sleep(100);
  assert.equal(replies.length, n + 1, 'no reply arrived');
  return replies.at(-1);
}
const say = (text, uid) => hook({type: 'message', message: {type: 'text', text}}, uid);
const tokenOf = async uid => (await say('แอป', uid))[0].contents.footer.contents[0].action.uri.split('#t=')[1];
const api = async (token, method, path, body) => {
  const r = await fetch(`${base}/api/${path}`, {method, headers: {Authorization: 'Bearer ' + token}, body: body && JSON.stringify(body)});
  return r.ok ? r.json() : r.status;
};

try {
  for (let i = 0; ; i++) {
    if (await fetch(base + '/').then(r => r.ok, () => false)) break;
    assert(i < 120, 'wrangler dev did not start');
    await sleep(500);
  }
  assert.match(await (await fetch(base + '/')).text(), /ป้าคีน/);  // the web app is served

  // webhook signature
  assert.equal(await hook({type: 'follow'}, 'u1', 'wrong'), 403);

  // adding the bot gives the user a chat menu whose first button opens the app
  await hook({type: 'follow'});
  assert.equal(menus.length, 1);
  assert.equal(menus[0].areas.length, 8);
  assert.match(menus[0].areas[0].action.uri, /#t=u1\.\d+\.[0-9a-f]{64}&add=1$/);
  assert.match((await hook({type: 'postback', postback: {data: 'help'}}))[0].text, /พิมพ์รายการได้เลย/);

  // recording: validation, category fallback, stated datetime
  entries = [
    {kind: 'expense', amount: 60, category: 'เครื่องดื่ม', note: 'กาแฟ', datetime: '2026-03-05 10:00'},
    {kind: 'income', amount: 1000, category: 'no such category', note: 'ขายของ'},
    {kind: 'expense', amount: -5, category: 'อาหาร', note: 'bad'},
    {kind: 'expense', amount: 'abc'},
    null,
  ];
  const card = (await say('กาแฟ 60 ขายของ 1000'))[0];
  assert.equal(geminiModel, 'fast-model');  // typed text goes to the fast model
  assert.deepEqual(geminiThinking, {thinkingLevel: 'low'});  // asked to think as little as it allows
  assert.ok(loadings > 0);  // typing dots shown while it worked
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.contents.length, 2);

  // tokens: the real one works, a tampered or foreign one does not
  const t1 = await tokenOf('u1'), t2 = await tokenOf('u2');
  assert.equal(menus.length, 2);  // one menu per user, not one per message
  assert.equal(await api(t1.slice(0, -1) + (t1.endsWith('0') ? '1' : '0'), 'GET', 'state'), 401);
  assert.equal(await api(t1.replace('u1.', 'u2.'), 'GET', 'state'), 401);
  assert.equal(await api('', 'GET', 'state'), 401);

  let state = await api(t1, 'GET', 'state');
  assert.deepEqual(state.entries.map(e => [e.note, e.amount]), [['ขายของ', 1000], ['กาแฟ', 60]]);
  const cats = Object.fromEntries(state.categories.map(c => [c.id, c.name]));
  const coffee = state.entries[1];
  assert.equal(coffee.ts, '2026-03-05 10:00');
  assert.equal(cats[coffee.category_id], 'เครื่องดื่ม');
  assert.equal(cats[state.entries[0].category_id], 'อื่นๆ');  // unknown category falls back

  // memory: user recategorises, the next entry with the same note follows
  const dessert = state.categories.find(c => c.name === 'ขนมหวาน').id;
  assert.deepEqual(await api(t1, 'PUT', `entries/${coffee.id}`, {category_id: dessert}), {});
  entries = [{kind: 'expense', amount: 70, category: 'เครื่องดื่ม', note: 'กาแฟ'}];
  assert.match(JSON.stringify((await say('กาแฟ 70'))[0]), /ขนมหวาน · จำจากครั้งก่อน/);

  // a respelled Thai note snaps back to what was typed; a real translation is kept
  entries = [{kind: 'expense', amount: 45, category: 'อาหาร', note: 'แกนวิสไสเกรอกไก'}, {kind: 'expense', amount: 20, category: 'อาหาร', note: 'water'}];
  const snapped = JSON.stringify(await say('แซนวิสไส้กรอกไก้ 45 น้ำ 20'));
  assert.match(snapped, /"แซนวิสไส้กรอกไก้"/);
  assert.match(snapped, /"water"/);

  // with channel tracking on, an expense without a channel gets asked about; income never does
  await api(t1, 'PUT', 'settings', {track_channel: true});
  entries = [{kind: 'income', amount: 500, category: 'เงินเดือน', note: 'โบนัส'}];
  assert.equal((await say('โบนัส 500')).some(m => m.quickReply), false);
  entries = [{kind: 'expense', amount: 40, category: 'อาหาร', note: 'ขนมปัง'}];
  const asked = (await say('ขนมปัง 40')).find(m => m.quickReply);
  const skip = asked.quickReply.items.at(-1).action;
  assert.equal(skip.label, 'ข้าม');
  assert.match((await hook({type: 'postback', postback: {data: skip.data}}))[0].text, /ไม่ระบุช่องทาง/);
  await api(t1, 'PUT', 'settings', {track_channel: false});

  // API validation and per-user isolation
  for (const bad of [{ts: '2026-01-01 10:00', kind: 'expense', amount: -1}, {kind: 'expense', amount: 5},
    {ts: '2026-02-31 10:00', kind: 'expense', amount: 5}, {ts: '2026-01-01 10:00', kind: 'x', amount: 5}, []]) {
    assert.equal(await api(t1, 'POST', 'entries', bad), 400, JSON.stringify(bad));
  }
  assert.equal(await api(t1, 'POST', 'users', {id: 'x'}), 400);
  assert.equal(await api(t1, 'PUT', `categories/${dessert}`, {color: 'red"><script>'}), 400);
  assert.deepEqual(await api(t1, 'PUT', `categories/${dessert}`, {color: '#E58C84'}), {});
  assert.equal(await api(t1, 'PUT', `categories/${dessert}`, {emoji: '<b>'}), 400);
  assert.deepEqual(await api(t1, 'PUT', `categories/${dessert}`, {emoji: '🍰'}), {});
  assert.equal((await api(t1, 'GET', 'state')).categories.find(c => c.id === dessert).emoji, '🍰');
  assert.equal((await api(t1, 'GET', 'state')).categories.find(c => c.id === dessert).color, '#E58C84');
  assert.equal(await api(t1, 'PUT', 'entries/1;DROP', {amount: 1}), 400);
  await api(t2, 'DELETE', `entries/${coffee.id}`);
  await api(t2, 'PUT', `entries/${coffee.id}`, {amount: 1});
  assert.equal((await api(t2, 'GET', 'state')).entries.length, 0);
  assert.equal((await api(t1, 'GET', 'state')).entries.find(e => e.id === coffee.id).amount, 60);
  assert.equal(await api(t1, 'PUT', 'settings', {cycle_day: 32}), 400);
  assert.deepEqual(await api(t1, 'PUT', 'settings', {cycle_day: 31}), {});
  assert.equal((await say('สรุป'))[0].type, 'flex');  // a day-31 cycle still resolves in a 30-day month
  await api(t1, 'PUT', 'settings', {cycle_day: 25, hacked: 1});
  state = await api(t1, 'GET', 'state');
  assert.equal(state.settings.cycle_day, 25);
  assert.equal('hacked' in state.settings, false);

  // recurring: catches up once, never twice, even with simultaneous requests
  const start = new Date(Date.now() - 2 * 864e5 + 7 * 36e5).toISOString().slice(0, 10);  // two days ago, Bangkok time
  await api(t1, 'POST', 'recurring', {kind: 'income', amount: 50, freq: 'daily', start, note: 'ค่าขนม'});
  const both = await Promise.all([api(t1, 'GET', 'state'), api(t1, 'GET', 'state')]);
  assert.equal((await api(t1, 'GET', 'state')).entries.filter(e => e.note === 'ค่าขนม').length, 3, JSON.stringify(both.map(s => s.entries.length)));

  // photo: bytes reach the model as base64
  entries = [{kind: 'expense', amount: 99, category: 'อาหาร', note: 'สมชาย ใจดี', party: 'person'}];
  const slip = await hook({type: 'message', message: {type: 'image', id: '42'}});
  assert.deepEqual(geminiParts[0].inline_data, {mime_type: 'image/jpeg', data: 'AQID'});
  assert.equal(geminiModel, 'ok-model');  // a photo goes to the stronger list; busy moves on at once, slow gets company after a few seconds
  assert.equal(geminiThinking, undefined);  // ok-model rejected the thinking setting, so it was asked again without

  // slip follow-up: paid in cash; to a person, so the bot asks the name, files it by that name (no category question), shows the card
  assert.match(slip[0].text, /พิมพ์ชื่อรายการ/);
  assert.deepEqual(slip[0].quickReply.items.map(i => i.action.label), ['ข้าม']);
  entries = [{kind: 'expense', amount: 1, category: 'เดินทาง', note: 'ค่าแท็กซี่ 7-11'}];  // the model's pick for the name
  const done = (await say('ค่าแท็กซี่ 7-11'))[0];  // a name may contain numbers
  assert.deepEqual(geminiParts, [{text: 'ค่าแท็กซี่ 7-11'}]);  // only the name goes to the model
  assert.equal(geminiModel, 'fast-model');
  assert.equal(done.type, 'flex');
  assert.match(JSON.stringify(done), /จดรายจ่ายแล้ว.*ค่าแท็กซี่ 7-11.*เดินทาง · เงินสด/);
  state = await api(t1, 'GET', 'state');
  const named = state.entries.find(e => e.note === 'ค่าแท็กซี่ 7-11');
  assert.equal(named.amount, 99);
  assert.equal(cats[named.category_id], 'เดินทาง');
  assert.deepEqual(state.channels.map(c => [c.name, c.type]), [['เงินสด', 'cash'], ['KTC', 'card'], ['UOB', 'card']]);
  assert.equal(state.channels.find(c => c.id === named.channel_id).name, 'เงินสด');
  assert.equal(state.settings.pending, null);

  // the same name on a later slip is filed from memory, without asking the model
  entries = [{kind: 'expense', amount: 55, category: 'อาหาร', note: 'สลิป'}];
  await hook({type: 'message', message: {type: 'image', id: '43'}});
  geminiParts = null;
  const again = (await say('ค่าแท็กซี่ 7-11'))[0];
  assert.equal(geminiParts, null);
  assert.match(JSON.stringify(again), /เดินทาง · เงินสด · จำจากครั้งก่อน/);

  // a slip paid to a shop or restaurant keeps that name: no question, the saved card straight away
  entries = [{kind: 'expense', amount: 120, category: 'อาหาร', note: 'ร้านส้มตำป้าแดง', party: 'business'}];
  const shop = (await hook({type: 'message', message: {type: 'image', id: '44'}}))[0];
  assert.equal(shop.type, 'flex');
  assert.match(JSON.stringify(shop), /จดรายจ่ายแล้ว.*ร้านส้มตำป้าแดง.*อาหาร · เงินสด/);
  assert.equal((await api(t1, 'GET', 'state')).settings.pending, null);

  // postbacks: delete is scoped to the owner; commands
  assert.equal((await hook({type: 'postback', postback: {data: `del:${coffee.id}`}}, 'u2'))[0].text, 'ไม่พบรายการนี้แล้วจ้ะ');
  assert.equal((await hook({type: 'postback', postback: {data: `del:${coffee.id}`}}))[0].text, 'ลบแล้วจ้ะ');
  assert.equal((await say('สรุป'))[0].type, 'flex');
  entries = [];
  assert.match((await say('สวัสดี'))[0].text, /พิมพ์รายการได้เลย/);

  // daily reminder: fires once for a user with nothing logged today
  await api(t2, 'PUT', 'settings', {remind: '00:00'});
  const menusBefore = menus.length;
  await fetch(base + '/__scheduled');
  await fetch(base + '/__scheduled');
  for (let i = 0; i < 50 && !pushes.length; i++) await sleep(100);
  await sleep(500);
  assert.deepEqual(pushes.map(p => p.to), ['u2']);
  assert.equal(menus.length, menusBefore);  // the scheduled job leaves up-to-date menus alone

  console.log('ok');
} finally {
  dev.kill();
  mock.close();
}
