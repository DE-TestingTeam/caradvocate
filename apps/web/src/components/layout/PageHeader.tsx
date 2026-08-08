import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  /** The page's primary action, sat on the same row as the title on `sm` and up. */
  action?: React.ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
  action,
}: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="space-y-2">
        {backTo && (
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel ?? "Back"}
          </Link>
        )}
        {/* Title and subtitle are one unit, tighter than the gap to the back link above them --
            hence the nested `space-y-1` rather than one `space-y` doing both jobs. */}
        <div className="space-y-1">
          {/* `text-h1` carries its own line-height and tracking, so there is no `tracking-tight`
              here -- the negative tracking a 40px heading needs is part of the size, not a choice
              made per heading. */}
          <h1 className="text-h1 font-bold">{title}</h1>
          {/*
            `text-sm`, matching the subtitle under "Ask CA". A subtitle is orientation, not
            reading matter: at `body-lg` it competed with the h1 for the first look, and every
            page opened with two lines of near-equal weight.

            `text-sm` rather than the `body` scale step deliberately -- `body` clamps up to 16px
            on a wide screen, which is where it stops matching Ask CA. `max-w-2xl` still caps the
            measure, since the page column is 1024px and that is far past readable for prose.
          */}
          {subtitle && <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {/* `shrink-0` so a long title wraps rather than squeezing the button. */}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
