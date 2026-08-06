import * as React from 'react';
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
import { useToast } from '@/components/ui/toast';
import { updateVehicle } from '@/lib/api';
import { invalidateAll } from '@/lib/useApi';
import type { Vehicle } from '@caradvocate/shared';


export function EditVehicleDialog({ vehicle }: { vehicle: Vehicle }) {
  const [open, setOpen] = React.useState(false);
  const [model, setModel] = React.useState(vehicle.model);
  const [trim, setTrim] = React.useState(vehicle.trim ?? '');
  const [mileage, setMileage] = React.useState(String(vehicle.mileage));
  const [vin, setVin] = React.useState('');
  const toast = useToast();

  React.useEffect(() => {
    if (open) {
      setModel(vehicle.model);
      setTrim(vehicle.trim ?? '');
      setMileage(String(vehicle.mileage));
      setVin('');
    }
  }, [open, vehicle]);

  /** Only offered when the car has none: filling a gap is useful, editing an established VIN is not. */
  const canAddVin = !vehicle.vin;
  // The API requires exactly 17 characters;
  const vinIncomplete = canAddVin && vin.trim().length > 0 && vin.trim().length !== 17;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const addedVin = canAddVin ? vin.trim().toUpperCase() : '';
    await updateVehicle({
      model: model.trim(),
      trim: trim.trim() || undefined,
      mileage: Number(mileage),
      ...(addedVin ? { vin: addedVin } : {}),
    });
    invalidateAll();
    setOpen(false);
    toast('Vehicle updated.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
          Edit vehicle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit vehicle</DialogTitle>
          <DialogDescription>This is the single vehicle record shared by My Car and Account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vehicle-model">Model</Label>
            <Input id="vehicle-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle-trim">Trim</Label>
            <Input id="vehicle-trim" value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="EX" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vehicle-mileage">Mileage</Label>
            <Input
              id="vehicle-mileage"
              type="number"
              min={0}
              inputMode="numeric"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
            />
          </div>
          {canAddVin && (
            <div className="space-y-2">
              <Label htmlFor="vehicle-vin">VIN (optional)</Label>
              <Input
                id="vehicle-vin"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="Add it now if you have it"
                maxLength={17}
                className="font-mono"
                autoComplete="off"
              />
              {vinIncomplete && <p className="text-sm text-muted-foreground">A VIN is exactly 17 characters.</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!model.trim() || Number(mileage) < 0 || vinIncomplete}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
