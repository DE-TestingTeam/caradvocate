import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createVehicle, decodeVin } from '@/lib/api';
import { invalidateAll } from '@/lib/useApi';

/**
 * Adds the user's car.
 *
 * Manual entry is the primary path because it always works. The VIN lookup is an
 * accelerator that prefills the same fields; if it fails for any reason the form
 * is already there and nothing is blocked. That matters because the VIN decode
 * calls an external service that may be unavailable.
 */
export function OnboardingPage() {
  const navigate = useNavigate();

  const [vin, setVin] = React.useState('');
  const [decoding, setDecoding] = React.useState(false);
  const [decodeNote, setDecodeNote] = React.useState<string>();

  const [year, setYear] = React.useState('');
  const [make, setMake] = React.useState('');
  const [model, setModel] = React.useState('');
  const [trim, setTrim] = React.useState('');
  const [mileage, setMileage] = React.useState('');

  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const vinLooksComplete = vin.trim().length === 17;
  const canSave =
    Number(year) >= 1900 && make.trim().length > 0 && model.trim().length > 0 && mileage !== '' && Number(mileage) >= 0;

  async function handleDecode() {
    setDecoding(true);
    setDecodeNote(undefined);
    setError(undefined);

    try {
      const decoded = await decodeVin(vin.trim());
      if (decoded.year) setYear(String(decoded.year));
      if (decoded.make) setMake(decoded.make);
      if (decoded.model) setModel(decoded.model);
      if (decoded.trim) setTrim(decoded.trim);
      setDecodeNote('Found it. Check the details below and add your mileage.');
    } catch {
      setDecodeNote("Could not look that VIN up. Fill in the details below instead — it works just as well.");
    } finally {
      setDecoding(false);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError(undefined);

    try {
      await createVehicle({
        year: Number(year),
        make: make.trim(),
        model: model.trim(),
        trim: trim.trim() || undefined,
        vin: vinLooksComplete ? vin.trim().toUpperCase() : undefined,
        mileage: Number(mileage),
      });
      invalidateAll();
      navigate('/my-car', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your vehicle.');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <h1 className="text-3xl font-bold tracking-tight">Add your car</h1>
      <p className="mt-1 text-muted-foreground">
        This is what everything else is built around — your history, recalls, and repair pricing.
      </p>

      <Card className="mt-6">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="space-y-2">
            <Label htmlFor="vin">VIN (optional)</Label>
            <p className="text-sm text-muted-foreground">
              17 characters, on the driver's side dashboard or door frame. We use it to fill in the rest.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="vin"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                  placeholder="1HGCM82633A004352"
                  maxLength={17}
                  className="pl-9 font-mono"
                  autoComplete="off"
                />
              </div>
              <Button type="button" variant="outline" disabled={!vinLooksComplete || decoding} onClick={handleDecode}>
                {decoding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up'}
              </Button>
            </div>
            {decodeNote && <p className="text-sm text-muted-foreground">{decodeNote}</p>}
          </div>

          <div className="h-px bg-border" />

          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  inputMode="numeric"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2019"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mileage">Mileage</Label>
                <Input
                  id="mileage"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  placeholder="68400"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="make">Make</Label>
              <Input id="make" value={make} onChange={(e) => setMake(e.target.value)} placeholder="Honda" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Civic" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trim">Trim (optional)</Label>
              <Input id="trim" value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="EX" />
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={!canSave || saving}>
              {saving ? 'Saving…' : 'Add vehicle'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
