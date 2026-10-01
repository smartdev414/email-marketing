"use client";

import { CheckIcon, ChevronDownIcon, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { cn } from "cn";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = { value: string; label: string };

type Props = {
  /** Query-string key the choice is stored under, e.g. `sort`. */
  param: string;
  options: Option[];
  /** Value used when the key is absent; choosing it removes the key. */
  defaultValue: string;
  label: string;
  /** Adds a search box above the options, for long lists such as mailboxes. */
  searchable?: boolean;
  searchPlaceholder?: string;
};

/** A dropdown filter that lives in the URL, like `SearchInput`. */
export function UrlSelect({
  param,
  options,
  defaultValue,
  label,
  searchable,
  searchPlaceholder,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const value = searchParams.get(param) ?? defaultValue;

  function change(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === defaultValue) params.delete(param);
    else params.set(param, next);
    params.delete("page");

    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  if (searchable) {
    return (
      <SearchableSelect
        value={value}
        options={options}
        label={label}
        placeholder={searchPlaceholder}
        onChange={change}
      />
    );
  }

  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label} className="max-w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Popover version of the dropdown with a filter box on top. Radix `Select`
 * captures typing for its own typeahead, so it cannot host an input.
 */
function SearchableSelect({
  value,
  options,
  label,
  placeholder = "Search…",
  onChange,
}: {
  value: string;
  options: Option[];
  label: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);

  const needle = term.trim().toLowerCase();
  const matches = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;
  const selected = options.find((option) => option.value === value) ?? options[0];

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTerm("");
      setActive(Math.max(0, options.indexOf(selected)));
    }
  }

  function pick(option: Option) {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && matches[active]) {
      event.preventDefault();
      pick(matches[active]);
    }
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={label}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 flex h-8 max-w-56 items-center justify-between gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3"
        >
          <span className="truncate">{selected?.label}</span>
          <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="relative border-b">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <input
            autoFocus
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            className="placeholder:text-muted-foreground h-9 w-full bg-transparent pr-2 pl-8 text-sm outline-none"
          />
        </div>
        <div id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">No matches</p>
          ) : (
            matches.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => pick(option)}
                onMouseMove={() => setActive(index)}
                className={cn(
                  "relative flex w-full items-center rounded-md py-1 pr-8 pl-1.5 text-left text-sm outline-none",
                  index === active && "bg-accent text-accent-foreground",
                )}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? (
                  <CheckIcon className="absolute right-2 size-4" />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
