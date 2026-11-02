// รายงานประจำเดือน: the numbers and ป้าคีน's analysis for one period. There is one copy for both sides, with no build
// step: the web app loads this as a plain script, and the worker imports it for the LINE card.
const shiftDay = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayCount = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;
const SAVE_GOAL = 20;  // the 20% of the 50/30/20 budgeting rule

// entries: at least this period's and the one before's. Dates are 'YYYY-MM-DD'; money(n) formats an amount.
// mood is the file name of the character that fits: public/chars/<mood>.png
globalThis.monthReport = ({entries, categories, from, to, prevFrom, prevTo, today, money, lang}) => {
  const t = (th, en) => lang === 'en' ? en : th;
  const inRange = (a, b) => entries.filter(e => e.ts.slice(0, 10) >= a && e.ts.slice(0, 10) <= b);
  const sum = (list, kind) => list.reduce((n, e) => n + (e.kind === kind ? e.amount : 0), 0);
  const finished = today > to, end = finished ? to : today < from ? from : today, elapsed = dayCount(from, end);
  const list = inRange(from, to), spent = list.filter(e => e.kind === 'expense');
  // a period still running is compared with the same number of days of the one before
  const prev = inRange(prevFrom, finished ? prevTo : [shiftDay(prevFrom, elapsed - 1), prevTo].sort()[0]);
  const income = sum(list, 'income'), expense = sum(list, 'expense'), left = income - expense;
  const rate = income > 0 ? Math.round(left / income * 1000) / 10 : null;

  const known = id => categories.some(c => c.id === id && c.kind === 'expense') ? id : 0;
  const byCat = rows => { const m = new Map(); for (const e of rows) if (e.kind === 'expense') m.set(known(e.category_id), (m.get(known(e.category_id)) || 0) + e.amount); return m; };
  const now = byCat(list), before = byCat(prev);
  const nameOf = id => categories.find(c => c.id === id)?.name ?? t('ไม่มีหมวด', 'Uncategorised');
  const cats = [...now].map(([id, total]) => ({id, name: nameOf(id), total, share: total / expense * 100})).sort((a, b) => b.total - a.total);

  const says = [];
  if (!list.length) says.push(t('รอบนี้ยังไม่มีรายการเลยจ้ะ จดไว้เรื่อยๆ แล้วป้าจะวิเคราะห์ให้นะ', 'Nothing recorded in this period yet. Keep noting things down and the analysis will appear here.'));
  else if (rate === null) says.push(t('รอบนี้ยังไม่มีรายรับ ป้าเลยคิดอัตราการเก็บออมไม่ได้จ้ะ ถ้ามีรายรับอย่าลืมจดนะ', 'No income recorded, so there is no savings rate to work out. Remember to note any income.'));
  else if (left < 0) says.push(t(`รอบนี้ใช้เกินรายรับไป ${money(-left)} ลองดูหมวดที่ใช้เยอะก่อนนะหลาน`, `You spent ${money(-left)} more than you earned. The biggest categories are the place to start.`));
  else if (rate >= SAVE_GOAL) says.push(t(`เก็บได้ ${rate}% ของรายรับ ถึงเกณฑ์ ${SAVE_GOAL}% ที่แนะนำกันแล้ว เก่งมากจ้ะหลาน`, `You saved ${rate}% of your income, past the recommended ${SAVE_GOAL}%. Well done!`));
  else says.push(t(`เก็บได้ ${rate}% ของรายรับ ถ้าเก็บเพิ่มอีก ${money(Math.ceil(income * SAVE_GOAL / 100 - left))} ก็จะถึง ${SAVE_GOAL}% จ้ะ`, `You saved ${rate}% of your income. Another ${money(Math.ceil(income * SAVE_GOAL / 100 - left))} would reach ${SAVE_GOAL}%.`));

  const was = sum(prev, 'expense');
  if (expense && was) {
    const diff = expense - was, pct = Math.round(Math.abs(diff) / was * 100);
    const th = finished ? 'รอบก่อน' : 'ช่วงเดียวกันของรอบก่อน', en = finished ? 'the period before' : 'the same days of the period before';
    says.push(pct < 3 ? t(`ใช้จ่ายใกล้เคียงกับ${th}จ้ะ`, `Spending is about the same as ${en}.`)
      : diff > 0 ? t(`ใช้จ่ายมากกว่า${th} ${money(diff)} (${pct}%)`, `You spent ${money(diff)} (${pct}%) more than ${en}.`)
      : t(`ใช้จ่ายน้อยกว่า${th} ${money(-diff)} (${pct}%) ดีมากจ้ะ`, `You spent ${money(-diff)} (${pct}%) less than ${en}. Nice!`));
  }
  if (cats.length) says.push(t(`เงินหมดไปกับ “${cats[0].name}” มากที่สุด ${money(cats[0].total)} (${Math.round(cats[0].share)}%)`, `“${cats[0].name}” took the most: ${money(cats[0].total)} (${Math.round(cats[0].share)}%).`));

  // the category that grew most, if it is big enough to matter
  const rise = was ? cats.map(c => ({...c, up: c.total - (before.get(c.id) || 0)}))
    .filter(c => c.up >= expense * .1 && c.up >= (before.get(c.id) || 0) * .25).sort((a, b) => b.up - a.up)[0] : null;
  if (rise) says.push(t(`“${rise.name}” เพิ่มขึ้น ${money(rise.up)} จากรอบก่อน`, `“${rise.name}” is up ${money(rise.up)} on the period before.`));

  // something bought again and again adds up without being noticed
  const items = new Map();
  for (const e of spent) { const k = (e.note || '').trim(); if (k) { const i = items.get(k) || {n: 0, total: 0}; i.n++; i.total += e.amount; items.set(k, i); } }
  const habit = [...items].filter(([, i]) => i.n >= 3).sort((a, b) => b[1].total - a[1].total)[0];
  if (habit) says.push(t(`“${habit[0]}” ${habit[1].n} ครั้ง รวม ${money(habit[1].total)}`, `“${habit[0]}” ${habit[1].n} times, ${money(habit[1].total)} in all.`));
  if (expense) says.push(t(`เฉลี่ยใช้วันละ ${money(Math.round(expense / elapsed))}`, `An average of ${money(Math.round(expense / elapsed))} a day.`));

  const mood = !list.length ? 'hello' : rate === null ? 'chart' : left < 0 ? 'worried' : rate >= SAVE_GOAL ? 'great' : 'good';
  return {income, expense, left, rate, cats, says: says.slice(0, 5), mood, finished};
};
