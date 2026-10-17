# Import RAF → admin@califacil.com

1. Abre Supabase → SQL Editor.
2. Ejecuta `00-grupos.sql` (una vez).
3. Ejecuta en orden `01-alumnos.sql` … `26-alumnos.sql`.

Totales matriz: 2816 grupos, 64898 alumnos.
Los scripts son idempotentes (no duplican por CURP ni por nombre en el mismo grupo).
