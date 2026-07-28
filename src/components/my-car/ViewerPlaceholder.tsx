import { ImageOff } from 'lucide-react';

/** Static stand-in for the interactive 360 viewer. Intentionally not interactive. */
export function ViewerPlaceholder() {
  return (
    <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-muted/40 sm:aspect-[2/1]">
      <ImageOff className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Interactive 360° view
      </span>
    </div>
  );
}
