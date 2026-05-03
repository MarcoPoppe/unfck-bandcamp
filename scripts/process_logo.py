"""Process the unfck-bandcamp logo PNG into theme-aware variants.

Input: a PNG with white background, black wordmark + blue parallelogram.
Output:
  public/logo/unfck-bandcamp-light.png  -> black text + blue, transparent background
  public/logo/unfck-bandcamp-dark.png   -> white text + blue, transparent background

Method per pixel:
  luminance = 0.299 R + 0.587 G + 0.114 B
  - white-ish (lum > 235 AND low saturation) -> alpha 0 (background)
  - dark-ish  (lum < 70  AND low saturation) -> stays black for light variant,
                                                 becomes white for dark variant
  - colored (e.g. the blue parallelogram)    -> kept as-is in both
  - mid-tones get an alpha ramp + colour ramp for smooth edges
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("C:/Users/marco/Downloads/ChatGPT Image 1. Mai 2026, 07_46_54.png")
OUT_LIGHT = ROOT / "public" / "logo" / "unfck-bandcamp-light.png"
OUT_DARK = ROOT / "public" / "logo" / "unfck-bandcamp-dark.png"

# Thresholds tuned for ChatGPT-generated rasterised wordmarks: the white
# background is essentially pure #fff but the brush strokes have antialiasing,
# so we want a smooth alpha ramp between ~225 and ~245.
WHITE_LUM_FULL = 245   # >= this luminance -> fully transparent
WHITE_LUM_FADE = 220   # below this -> not background at all (alpha based on darkness)
SAT_THRESHOLD = 35     # max(R,G,B) - min(R,G,B) below this counts as grayscale


def luminance(r: int, g: int, b: int) -> float:
    return 0.299 * r + 0.587 * g + 0.114 * b


def saturation(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def process(src_path: Path, dark_mode: bool) -> Image.Image:
    img = Image.open(src_path).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = pixels[x, y]
            sat = saturation(r, g, b)
            lum = luminance(r, g, b)

            if sat < SAT_THRESHOLD:
                # Grayscale (background or text). Treat as alpha-only.
                if lum >= WHITE_LUM_FULL:
                    pixels[x, y] = (0, 0, 0, 0)
                elif lum >= WHITE_LUM_FADE:
                    # Smooth ramp between fully-opaque-text and fully-transparent
                    # white. The darker the pixel, the more visible.
                    t = (WHITE_LUM_FULL - lum) / (WHITE_LUM_FULL - WHITE_LUM_FADE)
                    alpha = int(round(t * 255))
                    if dark_mode:
                        # In dark mode the "ink" is white. lum is high here so
                        # blending towards white keeps stroke edges crisp.
                        pixels[x, y] = (255, 255, 255, alpha)
                    else:
                        # Keep the original gray so antialiased edges look the
                        # same as on a white background.
                        pixels[x, y] = (r, g, b, alpha)
                else:
                    # Solid text body.
                    if dark_mode:
                        pixels[x, y] = (255, 255, 255, 255)
                    else:
                        pixels[x, y] = (r, g, b, 255)
            else:
                # Coloured pixel (the blue parallelogram). Keep colour and
                # full opacity in both variants.
                pixels[x, y] = (r, g, b, 255)
    return img


def crop_to_content(img: Image.Image, padding: int = 12) -> Image.Image:
    """Trim transparent margins to a tight bbox plus a small padding so the
    wordmark fills the height of its rendered <Image> container."""
    bbox = img.getbbox()
    if not bbox:
        return img
    left, upper, right, lower = bbox
    w, h = img.size
    left = max(0, left - padding)
    upper = max(0, upper - padding)
    right = min(w, right + padding)
    lower = min(h, lower + padding)
    return img.crop((left, upper, right, lower))


def main() -> int:
    if not SRC.exists():
        print(f"Source not found: {SRC}", file=sys.stderr)
        return 1

    OUT_LIGHT.parent.mkdir(parents=True, exist_ok=True)

    light = crop_to_content(process(SRC, dark_mode=False))
    light.save(OUT_LIGHT, "PNG", optimize=True)
    print(f"wrote {OUT_LIGHT}  ({light.size}, {OUT_LIGHT.stat().st_size // 1024} KB)")

    dark = crop_to_content(process(SRC, dark_mode=True))
    dark.save(OUT_DARK, "PNG", optimize=True)
    print(f"wrote {OUT_DARK}  ({dark.size}, {OUT_DARK.stat().st_size // 1024} KB)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
