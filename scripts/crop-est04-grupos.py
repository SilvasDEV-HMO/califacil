from PIL import Image
import os

pages = r"C:\Users\alfon\proyectos\CALIFACIL\scripts\tecnicas-listas-extract\pages"
out = r"C:\Users\alfon\proyectos\CALIFACIL\scripts\tecnicas-listas-extract\grupos"
os.makedirs(out, exist_ok=True)
for name in sorted(os.listdir(pages)):
    if not name.startswith("scan_") or not name.endswith(".jpg"):
        continue
    if "_rot" in name:
        continue
    im = Image.open(os.path.join(pages, name))
    w, h = im.size
    # header band with CCT/GRUPO/TURNO
    band = im.crop((0, 0, w, int(h * 0.14)))
    band.save(os.path.join(out, name.replace(".jpg", "_g.jpg")), quality=85)
    print(name, band.size)
