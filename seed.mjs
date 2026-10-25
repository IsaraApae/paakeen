// Fills a local `wrangler dev` (on :8787, LINE_CHANNEL_SECRET=dev) with a test user "Udev" and about six months of
// sample entries, then prints a link that opens the web app as that user. Usage: node seed.mjs
import {createHmac} from 'node:crypto';
const base = 'http://localhost:8787', uid = 'Udev';
const body = JSON.stringify({events: [{type: 'follow', replyToken: 'r', source: {type: 'user', userId: uid}}]});
await fetch(base + '/webhook', {method: 'POST', body, headers: {'X-Line-Signature': createHmac('sha256', 'dev').update(body).digest('base64')}});
await new Promise(r => setTimeout(r, 1500));
const p = `${uid}.${Math.floor(Date.now() / 1000) + 30 * 86400}`, token = p + '.' + createHmac('sha256', 'app-tokendev').update(p).digest('hex');
const api = (method, path, b) => fetch(`${base}/api/${path}`, {method, headers: {Authorization: 'Bearer ' + token}, body: b && JSON.stringify(b)}).then(r => r.json());
const s = await api('GET', 'state');
const cat = n => s.categories.find(c => c.name === n)?.id, ch = n => s.channels.find(c => c.name === n)?.id;
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const items = [['อาหาร', ['ข้าวมันไก่', 'ก๋วยเตี๋ยว', 'Yoshinoya', 'ส้มตำ', 'ข้าวกะเพรา'], 50, 180, 9], ['เครื่องดื่ม', ['กาแฟ', 'HEYTEA', 'ชาไข่มุก'], 45, 140, 6],
  ['ขนมหวาน', ['บิงซู', 'After You'], 80, 260, 2], ['เดินทาง', ['BTS', 'Grab', 'น้ำมัน'], 30, 400, 4], ['ชอปปิ้ง', ['Uniqlo', 'Shopee'], 150, 900, 1],
  ['บันเทิง', ['หนัง', 'Netflix'], 120, 420, 1], ['ค่าน้ำค่าไฟ', ['ค่าไฟ', 'ค่าน้ำ'], 90, 900, 1], ['ของขวัญ', ['ของขวัญวันเกิด'], 300, 800, 0.3]];
const pad = n => String(n).padStart(2, '0'), now = new Date();
for (let back = 6; back >= 0; back--) {  // six full months before this one, then this month up to today
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1), y = d.getFullYear(), m = d.getMonth() + 1;
  const last = back ? new Date(y, m, 0).getDate() : now.getDate();
  await api('POST', 'entries', {ts: `${y}-${pad(m)}-01 09:00`, kind: 'income', amount: 8000, note: 'เงินเดือน', category_id: cat('เงินเดือน')});
  for (const [c, notes, lo, hi, per] of items) for (let k = 0; k < Math.round(per * (0.6 + rnd() * 0.8) * last / 30); k++) {
    await api('POST', 'entries', {ts: `${y}-${pad(m)}-${pad(1 + Math.floor(rnd() * last))} ${pad(8 + Math.floor(rnd() * 13))}:${pad(Math.floor(rnd() * 60))}`, kind: 'expense',
      amount: Math.round(lo + rnd() * (hi - lo)), note: notes[Math.floor(rnd() * notes.length)], category_id: cat(c), channel_id: ch(['เงินสด', 'KTC', 'UOB'][Math.floor(rnd() * 3)])});
  }
}
console.log((await api('GET', 'state')).entries.length, 'entries\n' + `${base}/#t=${token}`);
