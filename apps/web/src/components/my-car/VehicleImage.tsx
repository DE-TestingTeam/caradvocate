/**
 * A studio photo of the owner's model, at the top of My Car. Two states: the photo, or the
 * placeholder. The placeholder is routine rather than an error -- no CarImages key, an
 * unphotographed model and an unreachable service all answer 200 with an empty body, so
 * there is no error branch to write.
 *
 * THIS IS NOT A PHOTO OF THEIR CAR. CarImages serves one photo per *generation* -- not the
 * owner's trim or colour, and for a model it has nothing for, a generic stand-in it gives us
 * no way to identify. The caption says so on screen rather than leaving it implied.
 */
import { ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getVehicleImage } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';
import type { Vehicle } from '@caradvocate/shared';

export function VehicleImage({ vehicle }: { vehicle: Vehicle }) {
  const photo = useApi(getVehicleImage, [vehicle.id]);

  // First load only. `useApi` keeps previous data through a refetch, and every mutation on
  // this page calls `invalidateAll` -- answering a recall question must not blank the car.
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
      <figcaption className="text-xs text-muted-foreground">
        A representative photo of this year and trim line — not a photo of your car.
      </figcaption>
    </figure>
  );
}

/**
 * 3:2, because that is what CarImages delivers -- every vehicle sampled comes back at
 * 1125x750 whatever `width` is requested, so the photo fills the frame edge to edge.
 * `object-contain` is belt and braces: a future asset with a different ratio letterboxes
 * rather than crops.
 *
 * Every state uses this frame, so the ratio also holds the layout steady while the photo
 * loads and the sections below do not jump.
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
