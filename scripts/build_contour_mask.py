"""Export the original photo and construct a fine splash mask from its alpha edge.

Usage: python3 scripts/build_contour_mask.py [source.png]
Requires Pillow, NumPy and OpenCV. Only the mask is stylized; photo pixels are
resized/encoded without retouching. The website uses the resulting static files.
"""

from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "mmexport1774798073197.png"
SEED = 1774798073
WIDTH = 2400
PADDING = 64
EDGE_INSET = 35


def noise_field(rng, shape, spacing):
    """Smooth, reproducible noise; spacing controls the size of the edge lobes."""
    height, width = shape
    grid = rng.uniform(-1, 1, (height // spacing + 2, width // spacing + 2)).astype(np.float32)
    return cv2.resize(grid, (width, height), interpolation=cv2.INTER_CUBIC)


def paths_from_binary(binary):
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    paths = []
    for contour in contours:
        if cv2.contourArea(contour) < 2:
            continue
        points = cv2.approxPolyDP(contour, 0.65, True).reshape(-1, 2)
        commands = [f"M{points[0, 0]},{points[0, 1]}"]
        commands.extend(f"L{x},{y}" for x, y in points[1:])
        paths.append(" ".join(commands) + " Z")
    return " ".join(paths)


def main():
    source = Image.open(SOURCE).convert("RGBA")
    bounds = source.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("The source photo is fully transparent")
    photo = source.crop(bounds)
    photo = photo.resize((WIDTH, round(photo.height * WIDTH / photo.width)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (photo.width + 2 * PADDING, photo.height + 2 * PADDING))
    canvas.paste(photo, (PADDING, PADDING))
    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)
    canvas.save(assets / "portrait-v2.webp", "WEBP", quality=88, method=6)

    alpha = np.asarray(canvas.getchannel("A"))
    support = (alpha > 32).astype(np.uint8)
    distance = cv2.distanceTransform(support, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    rng = np.random.default_rng(SEED)
    # A thin band follows every real edge, including the source's concave corner.
    # Several lobe scales replace the previous large, cartoon-like splash arms.
    threshold = (EDGE_INSET
                 + 18 * noise_field(rng, support.shape, 46)
                 + 12 * noise_field(rng, support.shape, 15)
                 + 4 * noise_field(rng, support.shape, 5))
    core = (distance > threshold).astype(np.uint8) * 255
    # Smooth subpixel jaggies while retaining the small liquid-shaped lobes.
    core = (cv2.GaussianBlur(core, (5, 5), 0.9) > 128).astype(np.uint8) * 255
    contours, _ = cv2.findContours(core, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contour = max(contours, key=cv2.contourArea).reshape(-1, 2)
    # Scatter small droplets between the inset edge and the original photo edge.
    # Keep each drop wholly inside real photo pixels and away from the core.
    away_from_core = cv2.distanceTransform(255 - core, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    candidates = np.argwhere((distance > 6) & (distance < 30) & (away_from_core > 7))
    rng.shuffle(candidates)
    drops = np.zeros_like(core)
    for y, x in candidates[:1600]:
        radius = float(rng.uniform(1.6, 5.8))
        if distance[y, x] < radius + 2 or away_from_core[y, x] < radius + 2:
            continue
        # Prevent clusters from becoming a second continuous outline.
        margin = 15
        if drops[max(0, y-margin):y+margin+1, max(0, x-margin):x+margin+1].any():
            continue
        cv2.ellipse(drops, (int(x), int(y)), (max(1, round(radius * 0.7)), round(radius)),
                    float(rng.uniform(0, 180)), 0, 360, 255, -1)
    mask = cv2.bitwise_or(core, drops)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {canvas.width} {canvas.height}">\n'
           '  <!-- Constructed from the source alpha contour; seed 1774798073. -->\n'
           f'  <path fill="white" d="{paths_from_binary(mask)}"/>\n'
           '</svg>\n')
    (assets / "contour-splash-mask.svg").write_text(svg)
    print(f"Exported {canvas.width}x{canvas.height}; source bounds {bounds}; "
          f"contour samples {len(contour)}")


if __name__ == "__main__":
    main()
