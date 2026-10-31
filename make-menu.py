"""Draw the LINE chat menu (public/menu.jpg) in the web app's style. macOS only (renders with qlmanage + sips).

Run: python3 make-menu.py
The tile boxes below must match MENU_TILES in src/index.js; bump MENU_VERSION there after changing the image.
"""
import os
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
# key, box (x, y, w, h), icon, label, subtitle, icon tint (the app's soft category colours)
TILES = [
    ("add", (60, 60, 1380, 1000), "plus", "จดรายการ", "พิมพ์ ส่งสลิป หรือส่งเสียงในแชตก็ได้", None),
    ("sum", (1500, 60, 440, 470), "home", "สรุป", None, "#E58C84"),
    ("ana", (2000, 60, 440, 470), "bars", "วิเคราะห์", None, "#86B2DE"),
    ("bud", (1500, 590, 440, 470), "pie", "หมวดหมู่", None, "#E8AC72"),
    ("list", (2000, 590, 440, 470), "list", "รายการ", None, "#9F9DDA"),
    ("chat", (60, 1120, 1380, 506), "chat", "สรุปในแชต", "ยอดรอบนี้ ตอบกลับทันที", "#93C79C"),
    ("set", (1500, 1120, 440, 506), "gear", "ตั้งค่า", None, "#A9A9B0"),
    ("help", (2000, 1120, 440, 506), "help", "วิธีใช้", None, "#C3A0D8"),
]
FONT = "font-family=\"'Sukhumvit Set', Thonburi, -apple-system, sans-serif\""


def icon(name, cx, cy, size, colour, width=2):
    return (f'<g transform="translate({cx - size / 2} {cy - size / 2}) scale({size / 24})" fill="none" stroke="{colour}" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"><path d="{ICON[name]}"/></g>')


def svg():
    # qlmanage renders a square thumbnail, so draw on a square canvas and crop the middle afterwards
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{W}" viewBox="0 0 {W} {W}">', """<defs>
  <linearGradient id="btn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF6961"/><stop offset="1" stop-color="#C24A44"/></linearGradient>
  <filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="20" stdDeviation="28" flood-color="#000" flood-opacity=".08"/><feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity=".04"/></filter>
</defs>""", f'<rect width="{W}" height="{W}" fill="#F5F5F7"/>', f'<g transform="translate(0 {(W - H) // 2})">']
    for key, (x, y, w, h), ic, label, sub, tint in TILES:
        r = 120 if w > 500 else 100
        out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="#FFFFFF" filter="url(#lift)"/>')
        if key == "add":
            cx, cy = x + 270, y + 280
            out.append(f'<circle cx="{cx}" cy="{cy}" r="192" fill="#FF6961" fill-opacity=".15"/>')
            out.append(f'<circle cx="{cx}" cy="{cy}" r="160" fill="url(#btn)"/>')
            out.append(icon(ic, cx, cy, 180, "#FFFFFF", 2.4))
            out.append(f'<text x="{x + 110}" y="{y + 700}" {FONT} font-weight="bold" font-size="200" fill="{LABEL}">{label}</text>')
            out.append(f'<text x="{x + 114}" y="{y + 865}" {FONT} font-size="84" fill="{LABEL2}">{sub}</text>')
        elif key == "chat":
            cx, cy = x + 240, y + h / 2
            out.append(f'<rect x="{cx - 130}" y="{cy - 130}" width="260" height="260" rx="84" fill="{tint}" fill-opacity=".22"/>')
            out.append(icon(ic, cx, cy, 140, LABEL))
            out.append(f'<text x="{x + 440}" y="{y + h / 2 - 5}" {FONT} font-weight="bold" font-size="136" fill="{LABEL}">{label}</text>')
            out.append(f'<text x="{x + 442}" y="{y + h / 2 + 115}" {FONT} font-size="82" fill="{LABEL2}">{sub}</text>')
        else:
            cx, cy = x + w / 2, y + h * .4
            out.append(f'<rect x="{cx - 105}" y="{cy - 105}" width="210" height="210" rx="68" fill="{tint}" fill-opacity=".22"/>')
            out.append(icon(ic, cx, cy, 120, LABEL))
            out.append(f'<text x="{cx}" y="{y + h - 85}" text-anchor="middle" {FONT} font-weight="bold" font-size="{90 if len(label) < 8 else 82}" fill="{LABEL}">{label}</text>')
    out += ["</g>", "</svg>"]
    return "\n".join(out)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "menu-source.svg"), "w", encoding="utf-8") as f:
        f.write(svg())
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["qlmanage", "-t", "-s", str(W), "-o", tmp, os.path.join(here, "menu-source.svg")], check=True, capture_output=True)
        png = os.path.join(tmp, "menu-source.svg.png")
        subprocess.run(["sips", "-c", str(H), str(W), png, "--out", png], check=True, capture_output=True)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90", png, "--out", os.path.join(here, "public", "menu.jpg")], check=True, capture_output=True)
    print("tiles for MENU_TILES:", [list(box) for _, box, *_ in TILES])
