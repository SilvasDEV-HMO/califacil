import os
import re

from PIL import Image, ImageOps

pages = r"C:\Users\alfon\proyectos\CALIFACIL\scripts\tecnicas-listas-extract\pages"
out = r"C:\Users\alfon\proyectos\CALIFACIL\scripts\tecnicas-listas-extract\headers"
os.makedirs(out, exist_ok=True)

for name in sorted(os.listdir(pages)):
    if not name.lower().endswith(".jpg"):
        continue
    path = os.path.join(pages, name)
    im = Image.open(path)
    # EST 22 is rotated: header on right. Others header on top.
    if "TEC_22" in name:
        im = im.rotate(-90, expand=True)
        im.save(os.path.join(pages, name.replace(".jpg", "_rot.jpg")), quality=80)
        w, h = im.size
        head = im.crop((0, 0, w, int(h * 0.18)))
        table = im.crop((0, int(h * 0.14), int(w * 0.55), h))
    else:
        w, h = im.size
        head = im.crop((0, 0, w, int(h * 0.22)))
        table = im.crop((0, int(h * 0.16), int(w * 0.62), h))
    head = ImageOps.autocontrast(head)
    table = ImageOps.autocontrast(table)
    head.save(os.path.join(out, name.replace(".jpg", "_head.jpg")), quality=85)
    table.save(os.path.join(out, name.replace(".jpg", "_table.jpg")), quality=70)
    print(name, im.size)
