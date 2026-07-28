import { Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts';

interface ValueTrendChartProps {
  data: { month: string; value: number }[];
  /** Sparkline mode: no axes, fixed small height. */
  compact?: boolean;
}

export function ValueTrendChart({ data, compact = false }: ValueTrendChartProps) {
  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={32}>
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={['dataMin - 200', 'dataMax + 200']} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="hsl(var(--foreground))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          dy={4}
        />
        <YAxis hide domain={['dataMin - 400', 'dataMax + 400']} />
        <Line
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--foreground))"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
