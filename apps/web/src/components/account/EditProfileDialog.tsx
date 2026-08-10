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
import { useVehicle } from '@/components/layout/RequireVehicle';
import { useToast } from '@/components/ui/toast';
import { updateAccount, updateVehicle } from '@/lib/api';
import { invalidateAll } from '@/lib/useApi';
import type { Account } from '@caradvocate/shared';

/**
 * The zip is edited here, with the contact details, because that is where an owner looks for it
 * -- it says where THEY are. It is stored on the vehicle (`vehicles.zip`), because the valuation
 * call that consumes it is per car, so saving it takes a second request. That split is this
 * component's business and nobody else's; the two calls are deliberately not combined into one
 * endpoint for a field that may well move if a second car is ever supported.
 */
export function EditProfileDialog({ account }: { account: Account }) {
  const vehicle = useVehicle();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(account.name);
  const [email, setEmail] = React.useState(account.email);
  const [phone, setPhone] = React.useState(account.phone);
  const [zip, setZip] = React.useState(vehicle.zip ?? '');
  const toast = useToast();

  // Re-sync when the dialog reopens so a cancelled edit does not stick.
  React.useEffect(() => {
    if (open) {
      setName(account.name);
      setEmail(account.email);
      setPhone(account.phone);
      setZip(vehicle.zip ?? '');
    }
  }, [open, account, vehicle]);

  // Blank is allowed -- the zip is optional and always has been. Anything typed has to be a
  // whole zip, since a partial one would be stored and then quietly fail every valuation call.
  const zipIncomplete = zip.trim().length > 0 && !/^\d{5}$/.test(zip.trim());

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (zipIncomplete) return;

    await updateAccount({ name: name.trim(), email: email.trim(), phone: phone.trim() });
    // Sent only when there is a whole zip and it changed. An emptied field is left alone rather
    // than cleared -- `updateVehicleSchema` has no way to say "no zip", so the request would
    // 422; carrying that over from the vehicle dialog rather than widening the API here.
    if (zip.trim() && zip.trim() !== vehicle.zip) {
      await updateVehicle({ zip: zip.trim() });
    }
    invalidateAll();
    setOpen(false);
    toast('Profile updated.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="w-full">
          Edit profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Update your contact details.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input id="profile-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-zip">Zip code</Label>
            <p className="text-sm text-muted-foreground">Used to estimate your car's market value.</p>
            <Input
              id="profile-zip"
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              placeholder="80215"
            />
            {zipIncomplete && <p className="text-sm text-destructive">Enter a 5-digit zip code.</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !email.trim() || zipIncomplete}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
