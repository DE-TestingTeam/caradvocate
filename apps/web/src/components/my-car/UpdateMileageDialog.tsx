import * as React from 'react';
import { Gauge } from 'lucide-react';
import { estimateCurrentMileage, type Vehicle } from '@caradvocate/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateVehicle } from '@/lib/api';
import { formatMileage } from '@/lib/format';
import { useWrite } from '@/lib/useWrite';

/**
 * The masthead's "Update mileage" action.
 *
 * MileageCheck still exists and still nags when the reading goes stale -- this is the other
 * half: a way to correct the odometer WITHOUT waiting to be asked. Every number on the
 * dashboard above prices or schedules off this one reading, so the control to fix it belongs
 * next to where it is displayed, not three months away behind a staleness rule.
 *
 * Prefilled with the same estimate MileageCheck uses, for the same reason: a figure to nudge
 * is answerable from the sofa, a blank box is not. The estimate is never saved unless the
 * owner submits it -- see estimateCurrentMileage in @caradvocate/shared.
 */
export function UpdateMileageDialog({ vehicle }: { vehicle: Vehicle }) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const { saving, write } = useWrite(() => setOpen(false));

  // Reset from the estimate each time it opens, so reopening never shows stale input.
  React.useEffect(() => {
    if (open) setValue(String(estimateCurrentMileage(vehicle)));
  }, [open, vehicle]);

  const entered = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(entered) && entered >= 0 && !saving;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;

    await write(
      () => updateVehicle({ mileage: entered }),
      'Thanks — your mileage is up to date.',
      'Could not save that.',
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gauge className="h-4 w-4" />
          Update mileage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update mileage</DialogTitle>
          <DialogDescription>
            We use your mileage to work out what upkeep is due and what the car is worth, so a
            current reading keeps both honest.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="update-mileage">Current mileage</Label>
            {/* `inputMode="numeric"` rather than `type="number"` -- same reasoning as
                MileageCheck: no spinner, no scroll-wheel accidents. */}
            <Input
              id="update-mileage"
              inputMode="numeric"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
            />
            <p className="text-xs text-muted-foreground">
              On file: {formatMileage(vehicle.mileage)}. The box starts from a guess based on
              typical driving — correct it to what the odometer actually says.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
