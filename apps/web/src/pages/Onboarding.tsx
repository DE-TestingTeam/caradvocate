import * as React from 'react';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createVehicle, decodeVin, getAccount, updateAccount } from '@/lib/api';
import { invalidateAll, useApi } from '@/lib/useApi';

type Step = 'profile' | 'vehicle';

/**
 * Two steps, not one long form: a name is a different, quicker decision than a car's details,
 * and asking for both at once would make the first screen look bigger than it is. The profile
 * step saves on "Continue" rather than waiting for the very end, so an owner who never finishes
 * adding a car still has a name on file rather than losing the whole visit.
 */
export function OnboardingPage() {
  const [step, setStep] = React.useState<Step>('profile');
  // Collected on the profile step, but only spent on the vehicle step (as part of
  // `createVehicle`), so it lives here rather than in either step alone.
  const [zip, setZip] = React.useState('');

  return (
    <div className="mx-auto w-full max-w-lg">
      {/* Two steps is too few to earn a full stepper (per UX guidance, that pays off past
          ~3) but still worth naming, so an owner knows a car question is coming right after
          this one. */}
      <p className="text-sm font-medium text-muted-foreground">Step {step === 'profile' ? 1 : 2} of 2</p>
      <div className="mt-2 flex gap-1.5">
        <div className="h-1.5 flex-1 rounded-full bg-primary" />
        <div className={`h-1.5 flex-1 rounded-full ${step === 'vehicle' ? 'bg-primary' : 'bg-muted'}`} />
      </div>

      {step === 'profile' ? (
        <ProfileStep onContinue={() => setStep('vehicle')} zip={zip} onZipChange={setZip} />
      ) : (
        <VehicleStep onBack={() => setStep('profile')} zip={zip} />
      )}
    </div>
  );
}

function ProfileStep({
  onContinue,
  zip,
  onZipChange,
}: {
  onContinue: () => void;
  zip: string;
  onZipChange: (zip: string) => void;
}) {
  const { data: account } = useApi(getAccount);

  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();

  // Phone (but not name) is worth prefilling: provisioning has no real phone number to
  // guess at, so an empty field here always means "never entered", while a guessed name
  // would sit in the field looking already-answered and inviting a driveby save.
  React.useEffect(() => {
    if (account) setPhone(account.phone);
  }, [account]);

  const canContinue = name.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canContinue || saving) return;

    setSaving(true);
    setError(undefined);

    try {
      await updateAccount({ name: name.trim(), phone: phone.trim() });
      invalidateAll();
      onContinue();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your details.');
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="mt-4 text-h2 font-bold">Welcome to CarAdvocate</h1>
      <p className="mt-1 text-muted-foreground">A couple of details, then let's add your car.</p>

      <Card className="mt-6">
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="onboarding-name">Your name</Label>
              <Input
                id="onboarding-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Rivera"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-phone">Phone (optional)</Label>
              <Input
                id="onboarding-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 018-2245"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboarding-zip">Zip code (optional)</Label>
              <p className="text-sm text-muted-foreground">Used to estimate your car's market value.</p>
              <Input
                id="onboarding-zip"
                inputMode="numeric"
                value={zip}
                onChange={(e) => onZipChange(e.target.value.replace(/\D/g, '').slice(0, 5))}
                placeholder="80215"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={!canContinue || saving}>
              {saving ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

function VehicleStep({ onBack, zip }: { onBack: () => void; zip: string }) {
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
  const zipLooksComplete = /^\d{5}$/.test(zip.trim());
  // The VIN is part of this, not just the lookup shortcut it used to be: valuation, the factory
  // schedule and the interval signal are all keyed by it, and nothing asks again afterwards.
  const canSave =
    vinLooksComplete &&
    Number(year) >= 1900 &&
    make.trim().length > 0 &&
    model.trim().length > 0 &&
    mileage !== '' &&
    Number(mileage) >= 0;

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
      // The VIN is kept either way -- only the prefill failed, and the rest of the app still
      // needs it. Saying "fill it in instead" here would read as permission to clear the field.
      setDecodeNote('Could not look that VIN up. Keep it as typed and fill in the details below yourself.');
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
        vin: vin.trim().toUpperCase(),
        mileage: Number(mileage),
        zip: zipLooksComplete ? zip.trim() : undefined,
      });
      invalidateAll();
      navigate('/my-car', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your vehicle.');
      setSaving(false);
    }
  }

  return (
    <>
      {/* Matches the back link in PageHeader exactly. Going back is the same action wherever it
          appears, so it should not be recognisable as a different control on this screen. */}
      <button
        type="button"
        onClick={onBack}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h1 className="mt-2 text-h2 font-bold">Add your car</h1>
      <p className="mt-1 text-muted-foreground">
        This is what everything else is built around — your history, recalls, and repair pricing.
      </p>

      <Card className="mt-6">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="space-y-2">
            <Label htmlFor="vin">VIN</Label>
            <p className="text-sm text-muted-foreground">
              17 characters, on the driver's side dashboard or door frame. It is what your car's value,
              service schedule and recalls are looked up by, so we need it to be right.
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
                  autoFocus
                />
              </div>
              <Button type="button" variant="secondary" disabled={!vinLooksComplete || decoding} onClick={handleDecode}>
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

            <Button type="submit" className="w-full" disabled={!canSave || saving}>
              {saving ? 'Saving…' : 'Add vehicle'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
