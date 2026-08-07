import * as React from 'react';
import { Plus } from 'lucide-react';
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
import { addServiceRecord, deleteServiceRecord, updateServiceRecord } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useWrite } from '@/lib/useWrite';
import type { MaintenanceItem, ServiceRecord } from '@caradvocate/shared';

export function LogServiceDialog({
  jobs,
  record,
  open: controlledOpen,
  onOpenChange,
}: {
  jobs: MaintenanceItem[];
  record?: ServiceRecord;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isEditing = record !== undefined;
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  /**
   * Whether this instance owns its own trigger button.
   *
   * Keyed on being controlled rather than on `record` being present: the editing
   * instance is mounted with `record` still undefined until a row is clicked, so
   * testing the record rendered a second "Log a service" button next to the first.
   */
  const isControlled = controlledOpen !== undefined;

  const [description, setDescription] = React.useState('');
  const [date, setDate] = React.useState(todayIso());
  const [cost, setCost] = React.useState('');
  const [mileage, setMileage] = React.useState('');
  const [jobId, setJobId] = React.useState('');
  const { saving, write } = useWrite(() => setOpen(false));

  // Reset from the record each time it opens, so reopening never shows stale input.
  React.useEffect(() => {
    if (!open) return;
    setDescription(record?.description ?? '');
    setDate(record?.date ?? todayIso());
    setCost(record ? String(record.cost) : '');
    setMileage(record?.mileageAtService ? String(record.mileageAtService) : '');
    setJobId(record?.maintenanceItemId ?? '');
  }, [open, record]);

  const valid =
    description.trim().length > 0 && date.length > 0 && cost !== '' && Number(cost) >= 0 && !saving;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;

    const body = {
      description: description.trim(),
      date,
      cost: Number(cost),
      mileageAtService: mileage.trim() === '' ? undefined : Number(mileage),
      maintenanceItemId: jobId === '' ? undefined : jobId,
    };

    await write(
      () => (record ? updateServiceRecord(record.id, body) : addServiceRecord(body)),
      record ? 'Record updated.' : 'Service logged to your history.',
      'Could not save that.',
    );
  }

  async function handleDelete() {
    if (!record) return;
    await write(() => deleteServiceRecord(record.id), 'Record deleted.', 'Could not delete that.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* A controlled instance is opened by its parent -- a history row, or the
          maintenance section -- so it must not render a trigger of its own.

          `sm`, because this trigger now sits on the Service history heading rule rather than
          full-width under the list. A default-height button there would outweigh the heading
          it sits beside. */}
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            <Plus className="h-4 w-4" />
            Log a service
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit service record' : 'Log a service'}</DialogTitle>
          <DialogDescription>
            Add a repair or maintenance record to your service history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="svc-description">Description</Label>
            <Input
              id="svc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Oil Change & Filter"
              autoComplete="off"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="svc-date">Date</Label>
              <Input id="svc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-cost">Cost</Label>
              <Input
                id="svc-cost"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="62"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svc-mileage">Mileage (optional)</Label>
            <Input
              id="svc-mileage"
              type="number"
              min={0}
              inputMode="numeric"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="68400"
            />
            <p className="text-xs text-muted-foreground">
              The odometer when the work was done. Needed to work out when this is next due.
            </p>
          </div>

          {jobs.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="svc-job">Counts as (optional)</Label>
              <select
                id="svc-job"
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Not one of my upkeep jobs</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/*
            Only Save is green. Two green buttons in a footer is no primary action at all, and a
            green Delete reads as the safe choice, which is the opposite of what it does.
          */}
          <DialogFooter className="sm:justify-between">
            {isEditing ? (
              <Button type="button" variant="outline" disabled={saving} onClick={handleDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid}>
                {saving ? 'Saving…' : 'Save record'}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
