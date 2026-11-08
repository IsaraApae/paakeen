"""Draw the LINE chat menu (public/menu.jpg) in the web app's style.

Run: python3 make-menu.py
It writes menu-source.svg on any system, and on macOS also renders public/menu.jpg from it (with qlmanage and sips).
Elsewhere, render the SVG's middle 2500x1686 to a JPEG under 1 MB some other way, such as a headless browser with the
Noto Sans Thai font loaded (the loopless Thai font closest to the iPhone's Sukhumvit Set).
The tile boxes below must match MENU_TILES in src/index.js; bump MENU_VERSION there after changing the image.
"""
import os
import platform
import subprocess
import tempfile

W, H = 2500, 1686
LABEL, LABEL2 = "#17171A", "#6B6B73"
ICON = {
    "home": "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
    "bars": "M6 20v-6M12 20V4M18 20v-9",
    "pie": "M21 12a9 9 0 1 1-9-9v9zM15 3.5A9 9 0 0 1 20.5 9H15z",
    "list": "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
    "gear": "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4M16 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM8 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM14 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
    "help": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
    "chat": "M4 5h16v11H10l-6 4z",
    "plus": "M12 5v14M5 12h14",
}
# Laid out like the app: the big red + to record an entry, and along the bottom the app's own menu bar, a white capsule
# with its five tabs, their line icons and names. The two chat actions sit beside the +.
BAR = (60, 1120, 2380, 506)
TAB_W = BAR[2] // 5
TABS = [("sum", "home", "สรุป"), ("ana", "bars", "วิเคราะห์"), ("bud", "pie", "หมวดหมู่"), ("list", "list", "รายการ"), ("set", "gear", "ตั้งค่า")]
# key, box (x, y, w, h), icon, label, subtitle
TILES = [
    ("add", (60, 60, 1380, 1000), "plus", "จดรายการ", "พิมพ์ ส่งสลิป หรือส่งเสียงในแชตก็ได้"),
    ("chat", (1500, 60, 940, 470), "chat", "สรุปในแชต", "ยอดรอบนี้ ตอบกลับทันที"),
    ("help", (1500, 590, 940, 470), "help", "วิธีใช้", "พิมพ์อะไรได้บ้าง"),
] + [(key, (BAR[0] + i * TAB_W, BAR[1], TAB_W, BAR[3]), ic, label, None) for i, (key, ic, label) in enumerate(TABS)]
FONT = "font-family=\"'Sukhumvit Set', 'Noto Sans Thai', Thonburi, -apple-system, sans-serif\""


def icon(name, cx, cy, size, colour, width=1.8):  # 1.8: the app's own stroke for these icons
    return (f'<g transform="translate({cx - size / 2} {cy - size / 2}) scale({size / 24})" fill="none" stroke="{colour}" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"><path d="{ICON[name]}"/></g>')


def card(x, y, w, h, r):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="#FFFFFF" filter="url(#lift)"/>'


def svg():
    # qlmanage renders a square thumbnail, so draw on a square canvas and crop the middle afterwards
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}" viewBox="0 0 {W} {W}">', """<defs>
  <linearGradient id="btn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6961"/><stop offset="1" stop-color="#C24A44"/></linearGradient>
  <filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000" flood-opacity=".08"/><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity=".04"/></filter>
</defs>""", f'<rect width="{W}" height="{W}" fill="#F5F5F7"/>', f'<g transform="translate(0 {(W - H) // 2})">']
    out.append(card(*BAR, BAR[3] // 2))  # the tabs share one capsule, as in the app
    for key, (x, y, w, h), ic, label, sub in TILES:
        if key == "add":  # the app's + button: the red gradient with its soft red ring
            out.append(card(x, y, w, h, 120))
            cx, cy = x + 270, y + 280
            out.append(f'<circle cx="{cx}" cy="{cy}" r="192" fill="#FF6961" fill-opacity=".15"/>')
            out.append(f'<circle cx="{cx}" cy="{cy}" r="160" fill="url(#btn)"/>')
            out.append(icon(ic, cx, cy, 180, "#FFFFFF", 2.4))
            out.append(f'<text x="{x + 110}" y="{y + 700}" {FONT} font-weight="bold" font-size="200" fill="{LABEL}">{label}</text>')
            out.append(f'<text x="{x + 114}" y="{y + 865}" {FONT} font-size="84" fill="{LABEL2}">{sub}</text>')
        elif sub:  # สรุปในแชต and วิธีใช้: icon, name, and a grey line
            out.append(card(x, y, w, h, 120))
            out.append(icon(ic, x + 150, y + 140, 120, LABEL))
            out.append(f'<text x="{x + 90}" y="{y + 310}" {FONT} font-weight="bold" font-size="116" fill="{LABEL}">{label}</text>')
            out.append(f'<text x="{x + 92}" y="{y + 418}" {FONT} font-size="70" fill="{LABEL2}">{sub}</text>')
        else:  # a tab of the bar: the icon over its name, as in the app's menu bar
            cx = x + w / 2
            out.append(icon(ic, cx, y + 200, 150, LABEL))
            out.append(f'<text x="{cx}" y="{y + 395}" text-anchor="middle" {FONT} font-weight="600" font-size="86" fill="{LABEL}">{label}</text>')
    out += ["</g>", "</svg>"]
    return "\n".join(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "menu-source.svg"), "w", encoding="utf-8", newline="\n") as f:
        f.write(svg() + "\n")
    if platform.system() == "Darwin":
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["qlmanage", "-t", "-s", str(W), "-o", tmp, os.path.join(here, "menu-source.svg")], check=True, capture_output=True)
            png = os.path.join(tmp, "menu-source.svg.png")
            subprocess.run(["sips", "-c", str(H), str(W), png, "--out", png], check=True, capture_output=True)
            subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90", png, "--out", os.path.join(here, "public", "menu.jpg")], check=True, capture_output=True)
    else:
        print(f"wrote menu-source.svg; render its middle {W}x{H} to public/menu.jpg (see the note at the top)")
    print("tiles for MENU_TILES:", [[*box, key] for key, box, *_ in TILES])
