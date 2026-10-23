import json
import os
import re

import pymupdf

folder = r"E:\alimentar califacil"
out = r"C:\Users\alfon\proyectos\CALIFACIL\scripts\tecnicas-listas-extract"
os.makedirs(out, exist_ok=True)

CURP_RE = re.compile(r"\b([A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d)\b")

groups = []
for name in sorted(os.listdir(folder)):
    if not name.lower().endswith(".pdf"):
        continue
    path = os.path.join(folder, name)
    doc = pymupdf.open(path)
    text = "\n".join((p.get_text("text") or "") for p in doc)
    doc.close()
    if "CCT:" not in text:
        continue
    cct_m = re.search(r"CCT:\s*([0-9]{2}[A-Z]{3}[0-9]{4}[A-Z])", text)
    grp_m = re.search(r"GRUPO:\s*1\s*-\s*([A-Z])", text)
    turno_m = re.search(r"TURNO:\s*([VM])", text)
    if not (cct_m and grp_m):
        print("NO HEADER", name)
        continue
    cct = cct_m.group(1)
    letter = grp_m.group(1)
    vesp = turno_m.group(1) == "V" if turno_m else False
    gname = f"{cct} · 1-{letter}" + (" V" if vesp else "")
    rows = []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    i = 0
    while i < len(lines):
        m = CURP_RE.search(lines[i])
        if m:
            curp = m.group(1)
            name_part = lines[i][m.end() :].strip(" /")
            j = i + 1
            while (
                j < len(lines)
                and not CURP_RE.search(lines[j])
                and not lines[j].startswith("Firma")
                and not lines[j].startswith("Powered")
                and not lines[j].isdigit()
                and len(lines[j]) > 3
            ):
                if "/" in lines[j] or name_part == "":
                    name_part = (name_part + " " + lines[j]).strip()
                    j += 1
                    break
                j += 1
            name_part = re.sub(r"\s+", " ", name_part).replace(" / ", " ").replace("/", " ").strip()
            if name_part:
                rows.append({"curp": curp, "name": name_part})
            i = j
            continue
        i += 1
    print(gname, "alumnos", len(rows), "file", name)
    groups.append({"groupName": gname, "file": name, "students": rows})

with open(os.path.join(out, "digital.json"), "w", encoding="utf-8") as f:
    json.dump(groups, f, ensure_ascii=False, indent=2)

scans = [
    "CamScanner 21-10-2026 09.34.pdf",
    "LISTA SOLICITADA TEC. 22.pdf",
    "scan_20261016100839.pdf",
    "scan_20261016101510.pdf",
]
imgdir = os.path.join(out, "pages")
os.makedirs(imgdir, exist_ok=True)
for name in scans:
    path = os.path.join(folder, name)
    doc = pymupdf.open(path)
    safe = re.sub(r"[^A-Za-z0-9]+", "_", name)[:40]
    print("RENDER", name, doc.page_count)
    for i, p in enumerate(doc):
        pix = p.get_pixmap(matrix=pymupdf.Matrix(1.35, 1.35), alpha=False)
        dest = os.path.join(imgdir, f"{safe}_p{i + 1:02d}.jpg")
        pix.save(dest, jpg_quality=68)
        print(" ", os.path.basename(dest), pix.width, pix.height, os.path.getsize(dest) // 1024, "kb")
    doc.close()
