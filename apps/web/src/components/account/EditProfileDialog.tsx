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
import { updateAccount } from '@/lib/api';
import { invalidateAll } from '@/lib/useApi';
import type { Account } from '@caradvocate/shared';

export function EditProfileDialog({ account }: { account: Account }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(account.name);
  const [email, setEmail] = React.useState(account.email);
  const [phone, setPhone] = React.useState(account.phone);
  const toast = useToast();

  // Re-sync when the dialog reopens so a cancelled edit does not stick.
  React.useEffect(() => {
    if (open) {
      setName(account.name);
      setEmail(account.email);
      setPhone(account.phone);
    }
  }, [open, account]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await updateAccount({ name: name.trim(), email: email.trim(), phone: phone.trim() });
    invalidateAll();
    setOpen(false);
    toast('Profile updated.');
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full">
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
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !email.trim()}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
