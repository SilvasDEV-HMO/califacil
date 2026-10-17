/** Supabase PostgREST limita a 1000 filas por defecto; hay que paginar. */
export const SUPABASE_PAGE_SIZE = 1000;

type RangeQuery<T> = {
  range: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * Ejecuta la query base en páginas de `pageSize` hasta agotar resultados.
 * `buildPage` debe devolver una query ya filtrada/ordenada, lista para `.range()`.
 */
export async function fetchAllPaged<T>(
  buildPage: () => RangeQuery<T>,
  pageSize = SUPABASE_PAGE_SIZE
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage().range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    all.push(...batch);
    if (batch.length < pageSize) break;
  }
  return all;
}
