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
import { useToast } from '@/components/ui/toast';
import { addServiceRecord } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { invalidateAll } from '@/lib/useApi';

/** NOTE: no wireframe for this dialog -- fields are the minimum a ServiceRecord needs. */
export function LogServiceDialog() {
  const [open, setOpen] = React.useState(false);
  const [description, setDescription] = React.useState('');
  const [date, setDate] = React.useState(todayIso());
  const [cost, setCost] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const toast = useToast();

  const valid = description.trim().length > 0 && date.length > 0 && Number(cost) >= 0 && cost !== '';

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;

    setSaving(true);
    await addServiceRecord({ description: description.trim(), date, cost: Number(cost) });
    invalidateAll();
    setSaving(false);
    setOpen(false);
    setDescription('');
    setDate(todayIso());
    setCost('');
    toast('Service logged to your history.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <Plus className="h-4 w-4" />
          Log a service
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a service</DialogTitle>
          <DialogDescription>Add a repair or maintenance record to your service history.</DialogDescription>
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? 'Saving…' : 'Save record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
