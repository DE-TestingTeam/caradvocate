import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';

type Mode = 'signin' | 'signup';

export function LoginPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = React.useState<Mode>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [notice, setNotice] = React.useState<string>();

  // Send people back where they were headed before the redirect to sign in.
  const from = (location.state as { from?: string } | null)?.from ?? '/my-car';

  const canSubmit = email.trim().length > 3 && password.length >= 6 && !busy;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(undefined);
    setNotice(undefined);

    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
        navigate(from, { replace: true });
      } else {
        await signUp(email.trim(), password);
        // Depending on the project's settings this may require confirming an
        // email first, so do not assume there is a session to redirect into.
        setNotice('Account created. If your project requires email confirmation, check your inbox.');
        setMode('signin');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      <h1 className="text-3xl font-bold tracking-tight">CarAdvocate</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {mode === 'signin' ? 'Sign in to see your car.' : 'Create an account to get started.'}
      </p>

      <Card className="mt-6">
        <CardContent className="p-4 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {error}
              </p>
            )}
            {notice && (
              <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">{notice}</p>
            )}

            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => {
              setError(undefined);
              signInWithGoogle().catch((cause: Error) => setError(cause.message));
            }}
          >
            Continue with Google
          </Button>
        </CardContent>
      </Card>

      <button
        type="button"
        className="mx-auto mt-4 text-sm underline underline-offset-4"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(undefined);
          setNotice(undefined);
        }}
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
