// How categories look: one copy for both sides, like report.js. The web app loads this as a plain script and the worker
// imports it for the LINE cards, so the cards and the app always show a category the same way.
globalThis.CATEGORY_LOOK = {
  // expense-category colours: the soft set, without green (green means รายรับ); a category uses its own choice, else the next
  PAL: ['#E58C84', '#E8AC72', '#DDC46A', '#7FC4BD', '#86B2DE', '#9F9DDA', '#C3A0D8', '#E39AB4', '#BBA38C', '#92C1D1', '#A9A9B0'],
  INCOME_COLOUR: '#35805A',  // income categories use the same green as รายรับ in สรุป
  // the built-in categories' emoji, shown by each device's own emoji font (Apple's on an iPhone or Mac); a category's own choice wins
  CAT_EMOJI: {'อาหาร': '🍜', 'เครื่องดื่ม': '🧋', 'ขนมหวาน': '🍰', 'บันเทิง': '🎬', 'ชอปปิ้ง': '🛍️', 'เดินทาง': '🚗', 'ค่าน้ำค่าไฟ': '💡', 'เรียน': '📚', 'ของขวัญ': '🎁', 'อื่นๆ': '📦', 'เงินเดือน': '💰'},
};
