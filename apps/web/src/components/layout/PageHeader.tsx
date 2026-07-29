import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
}

export function PageHeader({ title, subtitle, backTo, backLabel }: PageHeaderProps) {
  return (
    <div className="mb-6 space-y-2">
      {backTo && (
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? 'Back'}
        </Link>
      )}
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
