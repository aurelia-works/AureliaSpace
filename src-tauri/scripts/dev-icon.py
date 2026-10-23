"""Makes the "AureliaSpace Dev" app icon: the normal icon with a tilted DEV sash across its
top-right corner. Run from the repo root, then `npx tauri icon src-tauri/icons-dev/icon.png -o src-tauri/icons-dev`:

    python3 src-tauri/scripts/dev-icon.py
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SASH = (98, 198, 222, 255)  # --work, the app's "busy" cyan
INK = (10, 12, 16, 255)


def main():
    base = Image.open(ROOT / "icons/icon.png").convert("RGBA")
    size = base.width
    left, top, right, bottom = base.split()[-1].getbbox()

    # A wide band, drawn flat then turned 45 degrees and laid over the corner.
    band_w, band_h = int(size * 0.9), int(size * 0.13)
    band = Image.new("RGBA", (band_w, band_h), SASH)
    draw = ImageDraw.Draw(band)
    font = ImageFont.truetype("/System/Library/Fonts/SFCompact.ttf", int(band_h * 0.66))
    try:
        font.set_variation_by_name("Black")
    except (OSError, ValueError):
        pass
    text = "DEV"
    box = draw.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    draw.text(((band_w - tw) / 2 - box[0], (band_h - th) / 2 - box[1]), text, font=font, fill=INK)
    band = band.rotate(-45, resample=Image.BICUBIC, expand=True)

    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    # Centre of the band sits on the diagonal near the top-right corner.
    inset = int((right - left) * 0.2)
    cx, cy = right - inset, top + inset
    layer.paste(band, (cx - band.width // 2, cy - band.height // 2), band)

    # Clip to the icon's own rounded square so the sash never sticks out.
    alpha = ImageChops.multiply(layer.split()[-1], base.split()[-1])
    layer.putalpha(alpha)
    out = Image.alpha_composite(base, layer)

    dest = ROOT / "icons-dev"
    dest.mkdir(exist_ok=True)
    out.save(dest / "icon.png")
    print(dest / "icon.png")


if __name__ == "__main__":
    main()
