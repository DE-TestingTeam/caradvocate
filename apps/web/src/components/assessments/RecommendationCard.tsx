import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { Assessment } from '@caradvocate/shared';

export function RecommendationCard({ assessment }: { assessment: Assessment }) {
  const { recommendation } = assessment;

  return (
    <Card>
      <CardContent className="space-y-2 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {recommendation.headline}
          </h2>
          <Badge className="shrink-0">{recommendation.badge}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {recommendation.body}
        </p>
      </CardContent>
    </Card>
  );
}
