"""Genera SQL idempotente para crear grupos RAF en admin@califacil.com."""
from pathlib import Path

names = [
    n.strip()
    for n in Path(__file__).with_name("raf-group-names.txt").read_text(encoding="utf-8").splitlines()
    if n.strip()
]


def esc(s: str) -> str:
    return s.replace("'", "''")


values = ",\n  ".join(f"('{esc(n)}')" for n in names)

sql = f"""-- Grupos Matriz RAF 2026-2027 solo para admin@califacil.com
-- Pegar en Supabase -> SQL Editor -> Run
-- Idempotente: no duplica nombres ya existentes de ese maestro.

WITH teacher AS (
  SELECT id
  FROM auth.users
  WHERE lower(trim(email)) = 'admin@califacil.com'
  LIMIT 1
),
wanted(name) AS (
  VALUES
  {values}
),
to_insert AS (
  SELECT t.id AS teacher_id, w.name
  FROM teacher t
  CROSS JOIN wanted w
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.teacher_id = t.id
      AND g.name = w.name
  )
)
INSERT INTO public.groups (teacher_id, name)
SELECT teacher_id, name
FROM to_insert;

SELECT
  (SELECT count(*) FROM public.groups g
    JOIN auth.users u ON u.id = g.teacher_id
   WHERE lower(trim(u.email)) = 'admin@califacil.com') AS total_grupos_admin,
  {len(names)}::int AS grupos_en_matriz;
"""

out = Path(__file__).with_name("import-raf-groups-admin.sql")
out.write_text(sql, encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size} bytes, {len(names)} groups)")
