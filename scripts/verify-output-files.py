"""Independently decode browser-generated exports and render the generated PDF."""
from pathlib import Path
import json
from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "outputs" / "browser-smoke"

with Image.open(OUT / "result.jpg") as image:
    assert image.size == (480, 640), image.size
    pixel = image.convert("RGB").getpixel((10, 10))
    assert pixel[2] > 180 and pixel[0] < 60, pixel
    print("JPEG rotation and real pixel orientation: valid")
with Image.open(OUT / "converted.webp") as image:
    assert image.format == "WEBP"
    assert image.size == (640, 480)
    print("WebP format and dimensions: valid")
for file in OUT.glob("*-转换*.jpg"):
    with Image.open(file) as image:
        image.load()
        assert image.size == (640, 480), (file.name, image.size)
        assert image.getpixel((10, 10))[0] > 170
print("Batch JPG exports decode with expected dimensions and nonempty pixels")
for file in OUT.glob("*-压缩.png"):
    with Image.open(file) as image:
        assert image.format == "PNG" and image.size == (640, 480)
adjusted_files = list(OUT.glob("*-已调整.jpg"))
assert len(adjusted_files) >= 2
for file in adjusted_files:
    with Image.open(file) as image:
        assert image.size == (640, 480)
        pixel = image.convert("RGB").getpixel((10, 10))
        assert pixel[0] > 230 and pixel[1] > 35, (file.name, pixel)
print("Batch compression and applied-brightness pixels independently verified")

pdf_path = OUT / "images.pdf"
reader = PdfReader(pdf_path, strict=True)
assert len(reader.pages) == 2
for page in reader.pages:
    assert len(page.images) == 1
    assert float(page.mediabox.width) > float(page.mediabox.height)
doc = pdfium.PdfDocument(str(pdf_path))
for index in range(len(doc)):
    page = doc[index]
    bitmap = page.render(scale=1)
    image = bitmap.to_pil().convert("RGB")
    colors = image.getcolors(maxcolors=2_000_000)
    assert colors and len(colors) > 20, "blank or invalid PDF render"
    image.save(OUT / f"pdf-page-{index + 1}.png")
    bitmap.close()
    page.close()
doc.close()
print("PDF: strict parser accepted 2 pages; both contain real images and render correctly")

summary = {"jpeg_rotation": True, "webp": True, "batch_images": True, "pdf_pages": 2, "pdf_strict_parse": True, "pdf_render": True}
(OUT / "independent-validation.json").write_bytes((json.dumps(summary, indent=2) + "\n").encode("utf-8"))
