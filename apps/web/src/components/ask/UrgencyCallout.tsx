import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Severity } from '@caradvocate/shared';

const severityStyles: Record<Severity, string> = {
  high: 'border-l-destructive bg-destructive/10 text-foreground',
  medium: 'border-l-warning bg-warning/10 text-foreground',
  low: 'border-l-muted-foreground bg-muted text-muted-foreground',
};

const iconStyles: Record<Severity, string> = {
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-muted-foreground',
};

export function UrgencyCallout({ level, text }: { level: Severity; text: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-sm border-l-4 p-3 text-sm', severityStyles[level])}>
      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', iconStyles[level])} />
      <span className="font-medium">{text}</span>
    </div>
  );
}
