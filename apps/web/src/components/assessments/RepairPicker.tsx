import * as React from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { RepairCatalogItem } from '@caradvocate/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface RepairPickerProps {
  items: RepairCatalogItem[];
  /** Catalog id of the selected repair, not its name -- that is what the API takes. */
  value: string | undefined;
  onChange: (repairId: string) => void;
}

export function RepairPicker({ items, value, onChange }: RepairPickerProps) {
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((item) => item.name.toLowerCase().includes(q)) : items;
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

      <ul className="max-h-56 space-y-2 overflow-y-auto pr-1" role="listbox" aria-label="Repairs">
        {filtered.map((item) => {
          const selected = value === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(item.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md border bg-muted/50 px-3 py-3 text-left text-sm transition-colors hover:bg-accent',
                  selected && 'border-foreground bg-background font-medium ring-1 ring-foreground',
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
    </div>
  );
}
