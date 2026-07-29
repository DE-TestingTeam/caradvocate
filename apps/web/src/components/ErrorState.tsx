import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { invalidateAll } from '@/lib/useApi';

/**
 * Shown when a query fails. Now that data comes from a server rather than
 * fixtures, "the request failed" is a state every screen has to be able to render
 * -- otherwise a stopped API just leaves skeletons spinning forever.
 */
export function ErrorState({ message, className }: { message?: string; className?: string }) {
  return (
    <Card className={className}>
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm text-muted-foreground">
          {message ?? 'Could not load this. The API may not be running.'}
        </p>
        <Button variant="outline" size="sm" onClick={() => invalidateAll()}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </div>
    </Card>
  );
}
