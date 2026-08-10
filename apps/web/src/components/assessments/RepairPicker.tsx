import * as React from 'react';
import { CheckCircle2, Circle, Search } from 'lucide-react';
import type { RepairCatalogItem } from '@caradvocate/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

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
      {/*
        A real label, not just `aria-label` plus a placeholder. A placeholder is gone the moment
        someone types, taking the only thing that said what the box was for with it.
      */}
      <div className="space-y-1.5">
        <Label htmlFor="repair-search">Search repairs</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="repair-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Not "or describe…": the filter is a substring match on the repair's name, so a
            // typed symptom matches nothing. Promising it here sent owners down the one road
            // this box cannot take them.
            placeholder="e.g. brake, battery, timing"
            className="pl-9"
          />
        </div>
      </div>

      {/*
        The list scrolls, so its last visible row is usually cut part-way through. The
        fade below marks that edge as "more further down" -- without it a sliver of a
        clipped row sitting above the next section just reads as broken layout.
      */}
      <div className="relative">
        <ul
          // Taller than it was, and capped against the viewport rather than a fixed 18rem: this
          // list scrolls inside a page that also scrolls, and the shorter it is the more of that
          // nested scrolling an owner has to do. `60vh` still leaves the step heading above it
          // and the next step visible below, which is what stops the inner list feeling like the
          // whole page.
          className="max-h-[min(26rem,60vh)] space-y-2 overflow-y-auto pr-1"
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
                  {/*
                    A radio dial, not a plus. Only one repair can be assessed at a time, and a
                    "+" on every row read as "add this one too" -- an owner picking a second
                    repair watches the first silently deselect. The empty circle says the rows
                    are alternatives before anything is picked, which a bare check on the
                    selected row alone cannot say.
                  */}
                  {selected ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && (
            // The old copy here said "try describing the symptom instead" -- which is what an
            // owner had just done, and the only thing this search cannot answer. It now offers
            // the two moves that actually work: a shorter word, or the whole list back.
            <li className="space-y-3 px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                No repairs match “{query.trim()}”. Try a shorter word, like “brake”.
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-sm font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Show all repairs
              </button>
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
