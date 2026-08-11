/**
 * A studio photo of the owner's model, at the top of My Car. Two states: the photo, or the
 * placeholder. The placeholder is routine rather than an error -- no CarImages key, an
 * unphotographed model and an unreachable service all answer 200 with an empty body, so
 * there is no error branch to write.
 *
 * THIS IS NOT A PHOTO OF THEIR CAR. CarImages serves one photo per *generation* -- not the
 * owner's trim or colour, and for a model it has nothing for, a generic stand-in it gives us
 * no way to identify. The app says so rather than leaving it implied -- behind an "i" on the
 * photo instead of a line of caption under it, so the header is not carrying a sentence of
 * small print. See PhotoDisclaimer for why that is hover *and* tap rather than hover alone.
 *
 * An interactive 3D model (`modelUrl`) is also available from the API -- see git history on
 * this file for the <model-viewer> version -- but the still photo is what's shown for now.
 */
import { ImageOff, Info } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { getVehicleImage } from '@/lib/api';
import { vehicleName } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { cn } from '@/lib/utils';
import type { Vehicle } from '@caradvocate/shared';

export function VehicleImage({
  vehicle,
  compact = false,
}: {
  vehicle: Vehicle;
  /** For thumbnail-sized frames: the no-photo placeholder drops its caption and the photo its
      "i" disclaimer -- at thumbnail size the button covered a quarter of the car, and a
      thumbnail invites less "that is my car" than the full-bleed photo did. */
  compact?: boolean;
}) {
  const photo = useApi(getVehicleImage, [vehicle.id]);

  // First load only. `useApi` keeps previous data through a refetch, and every mutation on
  // this page calls `invalidateAll` -- answering a recall question must not blank the car.
  if (photo.loading && !photo.data) {
    return (
      <Frame className="bg-muted/40">
        <Skeleton className="h-full w-full" />
      </Frame>
    );
  }

  const url = photo.data?.imageUrl;
  if (!url) return <Unavailable compact={compact} />;

  return (
    <figure className="relative">
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
      {/* Outside Frame, which clips its own overflow -- the panel would be cut off inside it. */}
      {!compact && <PhotoDisclaimer />}
    </figure>
  );
}

/**
 * The "not your car" caveat, behind an "i" on the corner of the image.
 *
 * Hover is not enough on its own. This is the one thing on the page correcting an assumption
 * the image actively invites, and a touch screen has no hover -- so a hover-only tooltip would
 * hide it from every phone, which is most of them. It opens on hover, on keyboard focus and on
 * tap: the panel is tied to `focus-within`, and tapping the button focuses it.
 *
 * Hand-rolled rather than a Radix tooltip for the same reason. Radix's tooltip deliberately
 * never opens on touch, and its popover needs a dependency and a click to dismiss. This has one
 * fixed position under a corner that cannot collide with anything, so there is nothing to
 * install and nothing to position.
 *
 * `aria-describedby` rather than a label: the caveat describes the photo, and a screen reader
 * should reach it without the button having to be found and activated first.
 */
function PhotoDisclaimer() {
  return (
    <span className="group absolute right-2 top-2">
      <button
        type="button"
        aria-label="About this photo"
        aria-describedby="photo-disclaimer"
        className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        id="photo-disclaimer"
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-9 z-10 w-56 rounded-md border bg-popover p-2.5 text-xs leading-relaxed text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        A representative photo of this year and trim line — not a photo of your car.
      </span>
    </span>
  );
}

/**
 * 3:2, because that is the ratio CarImages delivers. `object-contain` is belt and braces: a
 * future asset with a different ratio letterboxes rather than crops.
 *
 * No background of its own. The photo has a transparent background and is meant to sit on the
 * page, so the fill belongs to the states that actually need one -- the skeleton and the
 * placeholder -- rather than to every state including the one it spoils.
 *
 * Every state uses this frame, so the ratio holds the layout steady while the photo loads and
 * the sections below do not jump.
 */
function Frame({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('aspect-[3/2] w-full overflow-hidden rounded-lg', className)}>{children}</div>
  );
}

/** What My Car shows when CarImages has nothing, or is not configured at all. */
function Unavailable({ compact = false }: { compact?: boolean }) {
  return (
    <Frame className="flex flex-col items-center justify-center gap-3 border-2 border-dashed bg-muted/40">
      <ImageOff className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      {/* The caption stays wherever it fits -- `compact` is the thumbnail case, where the
          frame is smaller than the sentence and the icon has to say it alone. */}
      {!compact && (
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          No photo for this model
        </span>
      )}
    </Frame>
  );
}
