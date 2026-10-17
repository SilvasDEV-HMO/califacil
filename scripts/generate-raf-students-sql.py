"""
Genera SQL idempotente para:
1) grupos CCT · grado-grupo
2) alumnos (nombre + CURP) en esos grupos
solo para admin@califacil.com.

Fuente: E:\\Matriz_RAF_Ciclo-2026-2027-RevDGSR.xlsx
"""
from __future__ import annotations

from pathlib import Path

import openpyxl

XLSX = Path(r"E:\Matriz_RAF_Ciclo-2026-2027-RevDGSR.xlsx")
OUT_DIR = Path(__file__).with_name("raf-import")
CHUNK = 2500
TEACHER = "admin@califacil.com"


def esc(s: str) -> str:
    return s.replace("'", "''")


def full_name(ap1: str, ap2: str, nom: str) -> str:
    parts = [p for p in (ap1.strip(), ap2.strip(), nom.strip()) if p]
    return " ".join(parts)


def school_group_label(cct: str, grado: str, grupo: str) -> str:
    return f"{cct} · {grado}-{grupo}"


def main() -> None:
    if not XLSX.exists():
        raise SystemExit(f"No está el Excel: {XLSX}")

    print("Leyendo Excel…")
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ws = wb["Matriz-RAF"]

    groups: set[str] = set()
    # (group_name, student_name, curp)
    students: list[tuple[str, str, str]] = []
    seen_in_group: set[tuple[str, str]] = set()  # (group, curp)

    for row in ws.iter_rows(min_row=2, values_only=True):
        cct = str(row[0] or "").strip().upper()
        curp = str(row[1] or "").strip().upper().replace(" ", "")
        ap1 = str(row[2] or "").strip()
        ap2 = str(row[3] or "").strip()
        nom = str(row[4] or "").strip()
        grado = str(row[5] or "").strip()
        grupo = str(row[6] or "").strip().upper()
        if not cct or not grado or not grupo:
            continue
        gname = school_group_label(cct, grado, grupo)
        groups.add(gname)
        name = full_name(ap1, ap2, nom)
        if not name or not curp or len(curp) < 16:
            continue
        key = (gname, curp)
        if key in seen_in_group:
            continue
        seen_in_group.add(key)
        students.append((gname, name, curp))

    wb.close()
    group_list = sorted(groups)
    print(f"Grupos: {len(group_list)} | Alumnos: {len(students)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.sql"):
        old.unlink()

    # 00 groups
    gvalues = ",\n  ".join(f"('{esc(n)}')" for n in group_list)
    groups_sql = f"""-- 00) Grupos RAF → {TEACHER}
-- Corre ESTE archivo primero en Supabase → SQL Editor → Run

WITH teacher AS (
  SELECT id
  FROM auth.users
  WHERE lower(trim(email)) = '{TEACHER}'
  LIMIT 1
),
wanted(name) AS (
  VALUES
  {gvalues}
),
to_insert AS (
  SELECT t.id AS teacher_id, w.name
  FROM teacher t
  CROSS JOIN wanted w
  WHERE NOT EXISTS (
    SELECT 1 FROM public.groups g
    WHERE g.teacher_id = t.id AND g.name = w.name
  )
)
INSERT INTO public.groups (teacher_id, name)
SELECT teacher_id, name FROM to_insert;

SELECT
  (SELECT count(*) FROM public.groups g
     JOIN auth.users u ON u.id = g.teacher_id
    WHERE lower(trim(u.email)) = '{TEACHER}') AS total_grupos_admin,
  {len(group_list)}::int AS grupos_en_matriz;
"""
    (OUT_DIR / "00-grupos.sql").write_text(groups_sql, encoding="utf-8")

    # student chunks
    parts = 0
    for i in range(0, len(students), CHUNK):
        parts += 1
        chunk = students[i : i + CHUNK]
        values = ",\n  ".join(
            f"('{esc(g)}', '{esc(n)}', '{esc(c)}')" for g, n, c in chunk
        )
        sql = f"""-- {parts:02d}) Alumnos RAF ({i + 1}-{i + len(chunk)} de {len(students)}) → {TEACHER}
-- Corre 00-grupos.sql primero. Luego estos archivos en orden.

WITH teacher AS (
  SELECT id
  FROM auth.users
  WHERE lower(trim(email)) = '{TEACHER}'
  LIMIT 1
),
rows(group_name, student_name, control_number) AS (
  VALUES
  {values}
),
to_insert AS (
  SELECT g.id AS group_id, r.student_name, r.control_number
  FROM rows r
  JOIN teacher t ON true
  JOIN public.groups g
    ON g.teacher_id = t.id
   AND g.name = r.group_name
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.group_id = g.id
      AND (
        s.control_number = r.control_number
        OR lower(trim(s.name)) = lower(trim(r.student_name))
      )
  )
)
INSERT INTO public.students (group_id, name, control_number)
SELECT group_id, student_name, control_number
FROM to_insert;

SELECT {len(chunk)}::int AS filas_en_lote;
"""
        (OUT_DIR / f"{parts:02d}-alumnos.sql").write_text(sql, encoding="utf-8")

    readme = f"""# Import RAF → {TEACHER}

1. Abre Supabase → SQL Editor.
2. Ejecuta `00-grupos.sql` (una vez).
3. Ejecuta en orden `01-alumnos.sql` … `{parts:02d}-alumnos.sql`.

Totales matriz: {len(group_list)} grupos, {len(students)} alumnos.
Los scripts son idempotentes (no duplican por CURP ni por nombre en el mismo grupo).
"""
    (OUT_DIR / "README.txt").write_text(readme, encoding="utf-8")
    print(f"Escrito en {OUT_DIR}: 00-grupos.sql + {parts} lotes de alumnos")


if __name__ == "__main__":
    main()
