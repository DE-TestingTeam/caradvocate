import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useVehicle } from '@/components/layout/RequireVehicle';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getRepairCatalog } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';

/**
 * Where a repair we cannot price for this car lands. Step 1 of the assessment lets any
 * repair be chosen -- picking the job the car needs is the owner's to decide, not ours to
 * gate -- so the refusal is delivered here, on the page that would otherwise have carried
 * the figures. That keeps "what do you need?" and "here is what we know" separate.
 *
 * The repair arrives as a query parameter rather than router state so a refresh still
 * works. `checked` comes from the catalog, and the two branches must not be collapsed:
 * only one of them is a fact about the owner's vehicle. See
 * apps/api/src/services/repairPricingSync.ts for why nothing is substituted.
 *
 * No wireframe covers this page -- they assume every repair is priced.
 */
export function AssessmentNoPricingPage() {
  const [params] = useSearchParams();
  const repairId = params.get('repair') ?? '';
  const vehicle = useVehicle();
  const catalog = useApi(getRepairCatalog);

  const repair = catalog.data?.repairs.find((item) => item.id === repairId);
  const car = vehicleName(vehicle);

  if (!catalog.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={repair?.name ?? 'No pricing available'}
        subtitle={car}
        backTo="/assessments/new"
        backLabel="Back to New Repair Assessment"
      />
      <Separator className="mb-6" />

      <Card className="space-y-2 p-6 text-sm text-muted-foreground">
        {catalog.data.checked ? (
          <>
            <p className="text-base font-medium text-foreground">
              We don&apos;t have pricing for this repair on your car.
            </p>
            <p>
              Our pricing source doesn&apos;t cover a {car} for this job. We won&apos;t
              estimate from a different vehicle, because that wouldn&apos;t tell you
              anything true about yours — a quote that looks fair against another car
              can be a bad deal on this one.
            </p>
          </>
        ) : (
          <>
            <p className="text-base font-medium text-foreground">
              We couldn&apos;t reach our pricing source.
            </p>
            <p>
              This isn&apos;t a problem with your car — we just haven&apos;t been able to
              look up prices for it yet. Try again shortly.
            </p>
          </>
        )}
      </Card>

      <div className="mt-6 space-y-3">
        <Button asChild size="lg" className="w-full">
          <Link to="/assessments/new">Pick a different repair</Link>
        </Button>
        {/* The way out, beneath the way forward -- only one of the two can be the green one. */}
        <Button asChild size="lg" variant="outline" className="w-full">
          <Link to="/assessments">Back to Repair Assessment</Link>
        </Button>
      </div>
    </div>
  );
}
