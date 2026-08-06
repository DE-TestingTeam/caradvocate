import * as React from "react";
import { Check, Plus, Search } from "lucide-react";
import type { RepairCatalogItem } from "@caradvocate/shared";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface RepairPickerProps {
  items: RepairCatalogItem[];
  /** Catalog id of the selected repair, not its name -- that is what the API takes. */
  value: string | undefined;
  onChange: (repairId: string) => void;
}

export function RepairPicker({ items, value, onChange }: RepairPickerProps) {
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter((item) => item.name.toLowerCase().includes(q))
      : items;
  }, [items, query]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search repairs or describe…"
          aria-label="Search repairs"
          className="pl-9"
        />
      </div>

      {/*
        The list scrolls, so its last visible row is usually cut part-way through. The
        fade below marks that edge as "more further down" -- without it a sliver of a
        clipped row sitting above the next section just reads as broken layout.
      */}
      <div className="relative">
        <ul
          className="max-h-72 space-y-2 overflow-y-auto pr-1"
          role="listbox"
          aria-label="Repairs"
        >
          {filtered.map((item) => {
            const selected = value === item.id;
            return (
              <li key={item.id}>
                {/*
                  Every repair is selectable, whether or not we hold pricing for this car.
                  The owner picks what the car actually needs; whether we can price it is
                  answered on the next page. Disabling the unpriced ones instead made the
                  picker refuse the question before it had been asked.
                */}
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onChange(item.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-3 text-left text-sm transition-colors hover:bg-accent",
                    // `ring-inset`, not a plain ring: an outward ring is drawn beyond the
                    // element's box, and this list scrolls, so the left edge of it was clipped
                    // by the overflow container while the right edge -- which has pr-1 to
                    // spare -- survived. Same thickness, drawn inside, nothing to clip and
                    // nothing that can disagree edge to edge.
                    selected &&
                      "border-foreground bg-background font-medium ring-1 ring-inset ring-foreground",
                  )}
                >
                  <span>{item.name}</span>
                  {selected ? (
                    <Check className="h-4 w-4 shrink-0" />
                  ) : (
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching repairs. Try describing the symptom instead.
            </li>
          )}
        </ul>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent"
        />
      </div>
    </div>
  );
}
