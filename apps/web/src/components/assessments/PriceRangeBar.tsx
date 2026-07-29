import { formatCurrency } from '@/lib/format';

interface PriceRangeBarProps {
  low: number;
  avg: number;
  high: number;
}

/** Horizontal benchmark range with a marker at the average. */
export function PriceRangeBar({ low, avg, high }: PriceRangeBarProps) {
  const span = Math.max(1, high - low);
  const percent = Math.min(100, Math.max(0, ((avg - low) / span) * 100));

  return (
    <div className="space-y-2">
      <div
        className="relative h-2 w-full rounded-full bg-muted"
        role="img"
        aria-label={`Benchmark range ${formatCurrency(low)} to ${formatCurrency(high)}, average ${formatCurrency(avg)}`}
      >
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <RangeLabel caption="Low" value={low} align="left" />
        <RangeLabel caption="Avg" value={avg} align="center" />
        <RangeLabel caption="High" value={high} align="right" />
      </div>
    </div>
  );
}

function RangeLabel({
  caption,
  value,
  align,
}: {
  caption: string;
  value: number;
  align: 'left' | 'center' | 'right';
}) {
  const alignment = align === 'left' ? 'text-left' : align === 'right' ? 'text-right' : 'text-center';
  return (
    <div className={alignment}>
      <div className="font-medium uppercase tracking-widest text-muted-foreground">{caption}</div>
      <div className="mt-0.5 text-sm font-semibold">{formatCurrency(value)}</div>
    </div>
  );
}
