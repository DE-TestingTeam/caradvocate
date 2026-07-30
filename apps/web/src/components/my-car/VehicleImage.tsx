/**
 * A studio photo of the owner's model, at the top of My Car.
 *
 * Two states: the photo, or the placeholder that stands in when there is none.
 * The placeholder is routine rather than an error -- it covers CarAdvocate running
 * without a CarImages key at all, a model CarImages has never photographed, and
 * CarImages being unreachable. The API answers 200 with an empty body for every
 * one of them, so there is no error branch to write.
 *
 * ===================== THIS IS NOT A PHOTO OF THEIR CAR =====================
 * CarImages serves one photo per *generation*. It is not the owner's trim, not
 * their colour, and for a model it has nothing for it is a generic placeholder --
 * and the signed-URL endpoint gives us no way to tell those apart, since it
 * answers 200 for a car that does not exist. On an app whose whole claim is that
 * it does not invent things about your car, that has to be said on screen rather
 * than left implied, which is what the caption is for.
 * ============================================================================
 */
import { ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getVehicleImage } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';
import type { Vehicle } from '@caradvocate/shared';

export function VehicleImage({ vehicle }: { vehicle: Vehicle }) {
  // Keyed on the car: a different vehicle is a different photo, and the signed URL
  // is short-lived enough that re-resolving on a change is the cheap option.
  const photo = useApi(getVehicleImage, [vehicle.id]);

  // Only on the first load. `useApi` keeps the previous data through a refetch, and
  // every mutation on this page calls `invalidateAll` -- answering a recall question
  // must not blank the car. The signed URL is stable for the life of the
  // server-side cache entry, so a refetch usually sets an identical `src`.
  if (photo.loading && !photo.data) {
    return (
      <Frame>
        <Skeleton className="h-full w-full" />
      </Frame>
    );
  }

  const url = photo.data?.imageUrl;
  if (!url) return <Unavailable />;

  return (
    <figure className="space-y-1.5">
      <Frame>
        <img
          src={url}
          alt={`${vehicleName(vehicle)}, representative photo`}
          className="h-full w-full object-contain"
          // It leads the page, so there is nothing to gain by deferring it.
          loading="eager"
          decoding="async"
        />
      </Frame>
      {/* See the header: the owner is told what they are looking at. */}
      <figcaption className="text-xs text-muted-foreground">
        A representative photo of this year and trim line — not a photo of your car.
      </figcaption>
    </figure>
  );
}

/**
 * 3:2, because that is what CarImages actually delivers.
 *
 * Every vehicle sampled -- Civic, Pathfinder, F-150, RAV4 -- comes back at
 * 1125x750 whatever `width` is requested, so matching the frame to the asset means
 * the photo fills it edge to edge with nothing letterboxed. `object-contain` is
 * belt and braces: if a future asset has a different ratio it will letterbox
 * rather than crop, and a cropped car is worse than a small margin.
 *
 * The ratio is also what holds the layout steady while the photo loads, so the
 * sections below do not jump. Every state uses this frame, so the page is the same
 * height whether the photo, the skeleton or the placeholder is in it.
 */
function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('aspect-[3/2] w-full overflow-hidden rounded-lg bg-muted/40', className)}>
      {children}
    </div>
  );
}

/** What My Car shows when CarImages has nothing, or is not configured at all. */
function Unavailable() {
  return (
    <Frame className="flex flex-col items-center justify-center gap-3 border-2 border-dashed">
      <ImageOff className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        No photo for this model
      </span>
    </Frame>
  );
}
