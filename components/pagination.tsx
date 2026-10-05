import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { pageHref, type PageInfo } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type Props = PageInfo & {
  pathname: string;
  /** The page's current search params, kept on every link. */
  params: Record<string, string | string[] | undefined>;
  /** Plural noun for the summary, e.g. "campaigns". */
  noun: string;
  className?: string;
};

/** First, last, and the pages around the current one; gaps become "…". */
function visiblePages(page: number, pageCount: number) {
  const pages = new Set([1, pageCount, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const items: (number | "gap")[] = [];
  for (const p of sorted) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && p - previous === 2) items.push(p - 1);
    else if (typeof previous === "number" && p - previous > 2) items.push("gap");
    items.push(p);
  }
  return items;
}

/**
 * Server-rendered pager driven by `?page=` in the URL, so every page has a
 * link of its own and filters, search and sort survive paging. The "Showing
 * x–y of z" summary is always shown; the page buttons only when there is more
 * than one page.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  skip,
  pathname,
  params,
  noun,
  className,
}: Props) {
  // Nothing to count on an empty list; its empty state says so.
  if (total === 0) return null;

  const href = (target: number) => pageHref(pathname, params, target);
  const first = skip + 1;
  const last = Math.min(skip + pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <p className="text-muted-foreground text-sm tabular-nums">
        Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} {noun}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page - 1)} aria-label="Previous page">
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="Previous page">
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">Previous</span>
            </Button>
          )}

          {visiblePages(page, pageCount).map((item, index) =>
            item === "gap" ? (
              <span key={`gap-${index}`} className="text-muted-foreground px-1.5 text-sm">
                …
              </span>
            ) : (
              <Button
                key={item}
                asChild
                size="sm"
                variant={item === page ? "secondary" : "ghost"}
                className="min-w-8 tabular-nums"
              >
                <Link
                  href={href(item)}
                  aria-label={`Page ${item}`}
                  aria-current={item === page ? "page" : undefined}
                >
                  {item}
                </Link>
              </Button>
            ),
          )}

          {page < pageCount ? (
            <Button asChild variant="outline" size="sm">
              <Link href={href(page + 1)} aria-label="Next page">
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="Next page">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      ) : null}
    </nav>
  );
}
