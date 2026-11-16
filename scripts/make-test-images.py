"""Generate isolated fixtures for browser and codec validation (no personal photos)."""
from pathlib import Path
from PIL import Image, ImageDraw
import math

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "outputs" / "test-images"
DEST.mkdir(parents=True, exist_ok=True)

# Clear color quadrants make rotation and crop assertions unambiguous.
im = Image.new("RGBA", (640, 480), (255, 255, 255, 255))
draw = ImageDraw.Draw(im)
draw.rectangle((0, 0, 319, 239), fill=(220, 30, 30, 255))
draw.rectangle((320, 0, 639, 239), fill=(30, 190, 40, 255))
draw.rectangle((0, 240, 319, 479), fill=(30, 70, 220, 255))
draw.rectangle((320, 240, 639, 479), fill=(245, 200, 20, 255))
im.save(DEST / "01-quadrants.png")
rgb = im.convert("RGB")
for name, fmt, opts in [
    ("02-quadrants.jpg", "JPEG", {"quality": 92}),
    ("03-quadrants.webp", "WEBP", {"quality": 88}),
    ("04-quadrants.bmp", "BMP", {}),
    ("05-quadrants.tiff", "TIFF", {"compression": "tiff_lzw"}),
    ("06-quadrants.avif", "AVIF", {}),
]:
    rgb.save(DEST / name, format=fmt, **opts)
im.resize((64, 64)).save(DEST / "07-quadrants.ico", format="ICO")
frames = [im.convert("RGB"), Image.new("RGB", im.size, (130, 180, 245))]
frames[0].save(DEST / "08-animation.gif", save_all=True, append_images=frames[1:], duration=300, loop=0)
transparent = Image.new("RGBA", (120, 80), (0, 0, 0, 0))
ImageDraw.Draw(transparent).rectangle((50, 20, 100, 60), fill=(180, 90, 80, 255))
transparent.save(DEST / "09-transparent.png")
(DEST / "10-vector.svg").write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#d9ecff"/><circle cx="70" cy="70" r="40" fill="#f1b966"/><path d="M0 200 120 80 240 200Z" fill="#439c9e"/></svg>')
(DEST / "broken.png").write_bytes(b"not a valid PNG")
(DEST / "ignored.txt").write_bytes(b"not an image")

# A pleasant landscape sample for the delivered viewer screenshot.
w, h = 1600, 1000
landscape = Image.new("RGB", (w, h))
px = landscape.load()
for y in range(h):
    t = y / h
    for x in range(w):
        glow = math.exp(-((x - 1050) ** 2 / 140000 + (y - 240) ** 2 / 100000))
        px[x, y] = (int(119 + 91 * t + 25 * glow), int(172 + 31 * t + 21 * glow), int(207 - 39 * t + 12 * glow))
draw = ImageDraw.Draw(landscape)
draw.ellipse((980, 170, 1120, 310), fill=(255, 223, 162))
draw.polygon([(0, 590), (220, 310), (400, 535), (660, 245), (930, 570), (1150, 370), (1400, 530), (1600, 330), (1600, 1000), (0, 1000)], fill=(103, 145, 158))
draw.polygon([(490, 430), (660, 245), (811, 427), (695, 361), (634, 389), (594, 349)], fill=(235, 238, 228))
draw.polygon([(0, 720), (240, 540), (500, 685), (740, 505), (1020, 690), (1310, 500), (1600, 675), (1600, 1000), (0, 1000)], fill=(66, 115, 125))
draw.polygon([(0, 800), (180, 720), (390, 780), (680, 695), (920, 760), (1200, 680), (1600, 750), (1600, 1000), (0, 1000)], fill=(48, 98, 106))
draw.polygon([(0, 850), (620, 840), (1150, 770), (1600, 840), (1600, 1000), (0, 1000)], fill=(126, 171, 175))
for y in range(860, 995, 13):
    draw.line((300 + (y % 31), y, 1370 - y % 91, y), fill=(164, 195, 189), width=2)
landscape.save(DEST / "00-mountain-lake.jpg", quality=94)
print(f"Generated fixtures: {DEST}")
