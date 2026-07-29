import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { addMaintenanceItem, deleteMaintenanceItem, updateMaintenanceItem } from '@/lib/api';
import { invalidateAll } from '@/lib/useApi';
import type { MaintenanceItem } from '@caradvocate/shared';

/**
 * Adds or edits one upkeep job.
 *
 * Both intervals are optional and blank means "not set", which the list then reports
 * as unknown. That is deliberate: an owner who does not know how often their brake
 * fluid needs doing should get "unknown" rather than a number we invented for them.
 * When both are given, whichever falls first wins — that is how manufacturers write
 * schedules ("every 10,000 miles or 12 months").
 */
export function MaintenanceItemDialog({
  item,
  open,
  onOpenChange,
}: {
  /** The job being edited, or undefined when adding. */
  item?: MaintenanceItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [label, setLabel] = React.useState('');
  const [miles, setMiles] = React.useState('');
  const [months, setMonths] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const toast = useToast();

  // Reset from the item each time it opens, so reopening never shows stale input.
  React.useEffect(() => {
    if (!open) return;
    setLabel(item?.label ?? '');
    setMiles(item?.intervalMiles ? String(item.intervalMiles) : '');
    setMonths(item?.intervalMonths ? String(item.intervalMonths) : '');
  }, [open, item]);

  const valid = label.trim().length > 0 && !saving;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;

    // Blank clears the interval rather than leaving the old value, so `null` has to
    // travel; sending undefined would silently keep it.
    const patch = {
      label: label.trim(),
      intervalMiles: miles.trim() === '' ? undefined : Number(miles),
      intervalMonths: months.trim() === '' ? undefined : Number(months),
    };

    setSaving(true);
    try {
      if (item) await updateMaintenanceItem(item.id, patch);
      else await addMaintenanceItem(patch);
      invalidateAll();
      onOpenChange(false);
      toast(item ? 'Job updated.' : 'Job added.');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setSaving(true);
    try {
      await deleteMaintenanceItem(item.id);
      invalidateAll();
      onOpenChange(false);
      // Said plainly, because it is not obvious that history survives.
      toast('Job removed. Your service records are untouched.');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not remove that.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Edit upkeep job' : 'Add an upkeep job'}</DialogTitle>
          <DialogDescription>
            How often it is due. Leave a field blank if you do not know — nothing will be guessed for you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job-label">Job</Label>
            <Input
              id="job-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Oil &amp; filter"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="job-miles">Every … miles</Label>
              <Input
                id="job-miles"
                type="number"
                min={1}
                inputMode="numeric"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="5000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-months">Every … months</Label>
              <Input
                id="job-months"
                type="number"
                min={1}
                inputMode="numeric"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                placeholder="12"
              />
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            {item ? (
              <Button type="button" variant="outline" disabled={saving} onClick={handleDelete}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <span className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid}>
                {saving ? 'Saving…' : item ? 'Save' : 'Add job'}
              </Button>
            </span>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
