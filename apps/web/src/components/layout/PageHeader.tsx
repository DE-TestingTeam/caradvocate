import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
}

export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel,
}: PageHeaderProps) {
  return (
    <div className="mb-8 space-y-2">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? "Back"}
        </Link>
      )}
      {/* `text-h1` carries its own line-height and tracking, so there is no `tracking-tight`
          here -- the negative tracking a 40px heading needs is part of the size, not a choice
          made per heading. */}
      <h1 className="text-h1 font-bold">{title}</h1>
      {/* `max-w-2xl` sets the subtitle's own measure. The page column is 1024px wide now, which
          is far past readable for a run of prose. */}
      {subtitle && <p className="max-w-2xl text-body-lg text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
