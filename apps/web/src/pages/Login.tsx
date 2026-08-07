import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/lib/auth';
import consumerReportsLogo from '@/assets/logos/Consumer_Reports_logo_2016.svg.webp';

type Mode = 'signin' | 'signup';

/** Shortest password Supabase accepts by default. Only enforced when creating an account. */
const MIN_PASSWORD_LENGTH = 6;

type FieldErrors = { email?: string; password?: string };

/**
 * Supabase's messages are written for whoever wired up the project, not for whoever is trying
 * to sign in -- "Invalid login credentials" reads like a system fault. Rewrite the handful we
 * expect and pass anything else through, so an unanticipated failure still says something
 * rather than being swallowed by a generic catch-all.
 */
function humanizeAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) {
    return 'That email and password do not match an account. Check both and try again.';
  }
  if (/already registered|already exists|user already/i.test(message)) {
    return 'An account already exists for that email. Try signing in instead.';
  }
  if (/email not confirmed/i.test(message)) {
    return 'Confirm your email first -- check your inbox for the link we sent.';
  }
  if (/rate limit|too many/i.test(message)) {
    return 'Too many attempts. Wait a minute, then try again.';
  }
  return message;
}

export function LoginPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [mode, setMode] = React.useState<Mode>('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [notice, setNotice] = React.useState<string>();
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  // Send people back where they were headed before the redirect to sign in.
  const from = (location.state as { from?: string } | null)?.from ?? '/my-car';

  /**
   * Checked on submit rather than gating the button. A button that is disabled until the form
   * happens to be valid gives someone a dead control and no reason for it; the rule that was
   * broken is more useful than the absence of a working button.
   */
  function validate(): FieldErrors {
    const next: FieldErrors = {};

    const trimmed = email.trim();
    if (!trimmed) next.email = 'Enter your email address.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) next.email = 'That does not look like an email address.';

    if (!password) {
      next.password = 'Enter your password.';
    } else if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      // Only a rule when creating the password. On sign-in the password is whatever it already
      // is, and telling someone it is too short when it is merely wrong sends them off course.
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setError(undefined);
    setNotice(undefined);

    const problems = validate();
    setFieldErrors(problems);
    if (problems.email || problems.password) {
      // Move focus to the first thing that needs fixing, so keyboard and screen-reader users
      // land on it instead of hunting back up the form.
      (problems.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setBusy(true);

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
      setError(cause instanceof Error ? humanizeAuthError(cause.message) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const passwordHintId = mode === 'signup' ? 'password-hint' : undefined;
  const passwordDescribedBy =
    [fieldErrors.password ? 'password-error' : undefined, passwordHintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center">
      {/*
        Two brands sharing a line, so they are balanced rather than sized alike. The lockup runs
        `h-10` because its wordmark is two stacked lines -- at the heading's own size those lines
        would be half the height of "CarAdvocate" and read as fine print. The heading sits at
        `text-2xl` to meet it. A hairline rule does the separating that a gap alone left
        ambiguous, which is the usual convention for a co-branded lockup.

        Centred: with the subtitle gone there is nothing else at this width to align a ragged
        left edge against, and the form below is centred in the column already.

        `alt=""` on purpose -- it is a brand mark beside the heading that names the product,
        and announcing "Consumer Reports" here adds nothing the user acts on.
      */}
      <div className="flex items-center justify-center gap-4">
        <img src={consumerReportsLogo} alt="" className="h-10 w-auto shrink-0" />
        <div className="h-8 w-px shrink-0 bg-border" />
        <h1 className="text-2xl font-bold tracking-tight">CarAdvocate</h1>
      </div>

      <div className="mt-8">
        {/* `noValidate` hands validation to the code above, so the messages match the ones
            shown everywhere else rather than the browser's own bubbles. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoFocus
              required
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
              placeholder="you@example.com"
              className={fieldErrors.email ? 'border-destructive' : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className="text-sm text-destructive">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                aria-invalid={fieldErrors.password ? true : undefined}
                aria-describedby={passwordDescribedBy}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                // `pr-10` keeps typed characters clear of the reveal button.
                className={fieldErrors.password ? 'border-destructive pr-10' : 'pr-10'}
              />
              {/*
                Stays focusable rather than being hidden from the tab order -- someone typing a
                password blind is exactly who needs to reach this without a mouse.
              */}
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="password-error" className="text-sm text-destructive">
                {fieldErrors.password}
              </p>
            )}
            {/* Helper text, not a placeholder: the rule has to survive the user typing. */}
            {passwordHintId && (
              <p id={passwordHintId} className="text-sm text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">{notice}</p>
          )}

          {/* Disabled only while a request is in flight, which is the one case where the
              reason is self-evident from the label. */}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/*
          Stays neutral. Google's sign-in branding expects a white or grey button, and putting
          our own colour on someone else's identity provider misrepresents whose it is.
        */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setError(undefined);
            signInWithGoogle().catch((cause: Error) => setError(humanizeAuthError(cause.message)));
          }}
        >
          Continue with Google
        </Button>
      </div>

      <Button
        variant="link"
        size="inline"
        className="mx-auto mt-4"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(undefined);
          setNotice(undefined);
          // The rules differ between the two modes, so errors raised under the old one no
          // longer apply.
          setFieldErrors({});
        }}
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </Button>
    </div>
  );
}
