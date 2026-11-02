// Draws ป้าคีน for the LINE cards and the report: public/chars/<name>.png (LINE cards take PNG or JPEG, not SVG).
//   npm i --no-save @resvg/resvg-js && node make-characters.mjs
// A doodle: a white blob with thin ink lines, a small pink nose and big expressions; a filter makes the lines wobble.
// After changing a drawing, bump CHAR_VERSION in src/index.js and public/index.html, because LINE caches images by address.
import {Resvg} from '@resvg/resvg-js';
import {mkdirSync, writeFileSync} from 'node:fs';

const INK = '#1F1F1F', PINK = '#F5A9B4', GOLD = '#FFD95A';
const line = (w = 3.5) => `fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const shape = (fill, w = 3.5) => `fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

// the blob stays open at the bottom, like the sticker it sits on; the little bun is what makes it ป้า
const blob = `<circle cx="120" cy="24" r="11" ${shape('#fff')}/><path d="M113 34Q120 38 127 34" ${line()}/>
  <path d="M10 234C16 196 50 178 58 128C66 66 90 34 120 34C150 34 174 66 182 128C190 178 224 196 230 234Z" fill="#fff"/>
  <path d="M10 234C16 196 50 178 58 128C66 66 90 34 120 34C150 34 174 66 182 128C190 178 224 196 230 234" ${line(4)}/>`;
const nose = `<ellipse cx="120" cy="108" rx="6.5" ry="5" ${shape(PINK, 2.5)}/>`;
const cheeks = `<ellipse cx="82" cy="120" rx="11" ry="7" fill="${PINK}" opacity=".55"/><ellipse cx="158" cy="120" rx="11" ry="7" fill="${PINK}" opacity=".55"/>`;

const EYES = {
  dot: `<circle cx="96" cy="96" r="4.5" fill="${INK}"/><circle cx="144" cy="96" r="4.5" fill="${INK}"/>`,
  happy: `<path d="M86 98Q96 84 106 98M134 98Q144 84 154 98" ${line(4)}/>`,
  wink: `<circle cx="96" cy="96" r="4.5" fill="${INK}"/><path d="M134 98Q144 84 154 98" ${line(4)}/>`,
  focus: `<path d="M87 96H105M135 96H153" ${line(4)}/>`,
  sparkle: `<circle cx="96" cy="94" r="10" ${shape('#fff', 3)}/><circle cx="144" cy="94" r="10" ${shape('#fff', 3)}/><circle cx="97" cy="96" r="5.5" fill="${INK}"/><circle cx="143" cy="96" r="5.5" fill="${INK}"/><circle cx="95" cy="93" r="1.8" fill="#fff"/><circle cx="141" cy="93" r="1.8" fill="#fff"/>`,
  brow: `<circle cx="96" cy="98" r="4.5" fill="${INK}"/><circle cx="144" cy="98" r="4.5" fill="${INK}"/><path d="M84 84Q96 76 106 84M134 78Q146 70 156 80" ${line(3.5)}/>`,
  sad: `<circle cx="96" cy="98" r="4.5" fill="${INK}"/><circle cx="144" cy="98" r="4.5" fill="${INK}"/><path d="M84 88L106 78M156 88L134 78" ${line(4)}/>
    <path d="M90 108C85 118 86 124 91 124C96 124 96 116 90 108Z" fill="#A9DDF5" stroke="${INK}" stroke-width="2.5"/><path d="M150 108C145 118 146 124 151 124C156 124 156 116 150 108Z" fill="#A9DDF5" stroke="${INK}" stroke-width="2.5"/>`,
};
const MOUTH = {
  smile: `<path d="M106 124Q120 138 134 124" ${line(4)}/>`,
  tongue: `<path d="M106 124Q120 138 134 124" ${line(4)}/><path d="M113 131Q113 148 121 148Q129 148 128 130" ${shape(PINK, 3)}/>`,
  huge: `<path d="M94 124Q120 116 146 124Q150 170 120 172Q90 170 94 124Z" fill="${INK}"/><path d="M104 158Q120 142 136 158Q130 172 120 172Q110 172 104 158Z" fill="${PINK}"/>`,
  small: `<ellipse cx="120" cy="128" rx="5" ry="6.5" fill="${INK}"/>`,
  flat: `<path d="M110 128H130" ${line(4)}/>`,
  wail: `<path d="M98 140Q120 118 142 140Q138 150 120 148Q102 150 98 140Z" fill="${INK}"/>`,
};
const face = (eyes, mouth) => `${blob}${cheeks}${EYES[eyes]}${nose}${MOUTH[mouth]}`;

// doodled props. A ฿ uses the same shape as the app icon's.
const baht = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s}) translate(-46 -43)"><path fill="${INK}" fill-rule="evenodd" d="M39 27H52A7.75 7.75 0 0 1 52 42.5H54.25A8.25 8.25 0 0 1 54.25 59H39A2 2 0 0 1 37 57V29A2 2 0 0 1 39 27Z M44 33H51.25A2.75 2.75 0 0 1 51.25 38.5H44Z M44 46H53A3.5 3.5 0 0 1 53 53H44Z"/><rect x="47.3" y="22" width="4.4" height="42" rx="2.2" fill="${INK}"/></g>`;
const coin = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" ${shape(GOLD, 3)}/>${baht(x, y, r / 34)}`;
const heart = (x, y, s) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 9C-16 -2 -9 -13 0 -5C9 -13 16 -2 0 9Z" fill="${PINK}" stroke="${INK}" stroke-width="${3 / s}"/>`;
const rays = (x, y, r) => [...Array(8)].map((_, i) => { const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); return `<path d="M${x + c * r} ${y + s * r}L${x + c * r * 1.7} ${y + s * r * 1.7}" ${line(3.5)}/>`; }).join('');
const sun = (x, y) => `<circle cx="${x}" cy="${y}" r="12" ${shape(GOLD, 3)}/>${rays(x, y, 17)}`;
const question = (x, y) => `<path d="M${x - 12} ${y - 10}Q${x - 10} ${y - 24} ${x} ${y - 24}Q${x + 14} ${y - 24} ${x + 14} ${y - 10}Q${x + 14} ${y - 2} ${x + 4} ${y + 2}Q${x} ${y + 5} ${x} ${y + 10}" ${line(5)}/><circle cx="${x}" cy="${y + 21}" r="3.6" fill="${INK}"/>`;
const hand = (x, y, a = 0) => `<path transform="rotate(${a} ${x} ${y})" d="M${x - 15} ${y + 12}Q${x - 18} ${y - 10} ${x} ${y - 13}Q${x + 18} ${y - 10} ${x + 15} ${y + 12}" ${shape('#fff')}/>`;
const thumb = (x, y) => `<path d="M${x - 16} ${y + 4}Q${x - 18} ${y + 24} ${x} ${y + 24}H${x + 10}Q${x + 20} ${y + 22} ${x + 18} ${y + 4}Q${x + 16} ${y - 4} ${x + 4} ${y - 4}L${x + 2} ${y - 20}Q${x - 6} ${y - 24} ${x - 8} ${y - 14}Z" ${shape('#fff')}/>`;
const waves = (x, y) => `<path d="M${x} ${y}Q${x + 8} ${y - 8} ${x + 4} ${y - 18}M${x + 12} ${y + 4}Q${x + 22} ${y - 6} ${x + 18} ${y - 20}" ${line(3)}/>`;
const note = `<g transform="rotate(-7 72 186)"><rect x="34" y="150" width="72" height="66" rx="4" ${shape('#fff')}/><path d="M46 168H94M46 182H94M46 196H78" ${line(3)}/></g>`;
const pencil = `<g transform="rotate(38 168 176)"><rect x="162" y="134" width="11" height="46" ${shape(GOLD, 3)}/><path d="M162 180L167.5 194L173 180Z" ${shape('#fff', 3)}/></g>`;
const sheet = `<rect x="62" y="150" width="116" height="78" rx="4" ${shape('#fff')}/><rect x="80" y="196" width="18" height="24" ${shape(PINK, 3)}/><rect x="110" y="180" width="18" height="40" ${shape('#fff', 3)}/><rect x="140" y="164" width="18" height="56" ${shape(GOLD, 3)}/>`;
const specs = `<circle cx="96" cy="94" r="16" ${line(5)}/><circle cx="144" cy="94" r="16" ${line(5)}/><path d="M112 92Q120 88 128 92M80 90L68 86M160 90L172 86" ${line(4)}/>`;
const bill = (x, y, a) => `<g transform="rotate(${a} ${x} ${y})"><rect x="${x - 22}" y="${y - 13}" width="44" height="26" rx="2" ${shape('#C9EBCF', 3)}/>${baht(x, y, .28)}</g>${waves(x - 30, y + 26)}`;
const drop = (x, y) => `<path d="M${x} ${y}C${x - 8} ${y + 12} ${x - 8} ${y + 20} ${x} ${y + 20}C${x + 8} ${y + 20} ${x + 8} ${y + 12} ${x} ${y}Z" ${shape('#A9DDF5', 3)}/>`;

const CHARS = {
  hello: `${heart(40, 66, 1.3)}${heart(204, 44, .9)}${face('wink', 'tongue')}${hand(196, 170, 20)}${waves(214, 150)}`,
  write: `${face('focus', 'flat')}${note}${pencil}${hand(176, 190, -30)}`,
  coins: `${coin(32, 84, 17)}${coin(212, 70, 20)}${coin(48, 34, 12)}${coin(186, 26, 13)}${face('sparkle', 'huge')}`,
  ask: `${question(208, 56)}${face('brow', 'small')}${hand(160, 164, -15)}`,
  chart: `${heart(204, 50, .9)}${face('dot', 'smile')}${specs}${sheet}${hand(62, 192, -90)}${hand(178, 192, 90)}`,
  great: `${sun(38, 50)}${coin(206, 56, 18)}${face('happy', 'huge')}${coin(34, 186, 15)}${coin(208, 190, 15)}`,
  good: `${coin(208, 70, 16)}${face('happy', 'smile')}${thumb(190, 178)}`,
  worried: `${bill(204, 64, 14)}${bill(44, 44, -16)}${face('sad', 'wail')}${drop(186, 116)}`,
};

mkdirSync('public/chars', {recursive: true});
Object.entries(CHARS).forEach(([name, art], i) => {
  const wobble = `<filter id="w" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="${i + 3}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs>${wobble}</defs><g filter="url(#w)">${art}</g></svg>`;
  writeFileSync(`public/chars/${name}.png`, new Resvg(svg, {fitTo: {mode: 'width', value: 360}}).render().asPng());
});
