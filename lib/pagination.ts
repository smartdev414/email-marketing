/** Reads `?page=` as a positive integer; anything else is page 1. */
export function parsePage(value: string | string[] | undefined) {
  const page = Number(typeof value === "string" ? value : 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * Clamps the requested page to the pages that exist, so deleting the last item
 * on the last page lands on the new last page instead of an empty one.
 */
export function pageInfo(requested: number, total: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  return { page, pageCount, skip: (page - 1) * pageSize, total, pageSize };
}

export type PageInfo = ReturnType<typeof pageInfo>;

/**
 * One page of a list that is already filtered and sorted in memory — for lists
 * whose sort depends on computed stats, so it cannot be done by the database.
 */
export function paginate<T>(items: T[], requested: number, pageSize: number) {
  const info = pageInfo(requested, items.length, pageSize);
  return { ...info, items: items.slice(info.skip, info.skip + pageSize) };
}

/** `?page=` on top of the current query string; page 1 drops it. */
export function pageHref(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
  page: number,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  if (page > 1) search.set("page", String(page));
  return search.size ? `${pathname}?${search.toString()}` : pathname;
}
