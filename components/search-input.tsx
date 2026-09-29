"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";

export function SearchInput({ placeholder = "Search…" }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set("q", value);
      else params.delete("q");
      params.delete("page");

      const next = `${pathname}?${params.toString()}`;
      startTransition(() => router.replace(next, { scroll: false }));
    }, 300);

    return () => clearTimeout(timer);
    // `searchParams` is intentionally read fresh inside the timer only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, pathname, router]);

  return (
    <div className="relative w-full sm:w-64">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="pl-8"
      />
    </div>
  );
}
