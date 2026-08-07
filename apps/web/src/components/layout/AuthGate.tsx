import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';

/**
 * Blocks the app until the user is authenticated. Not a security boundary: the API enforces
 * access on every request; this only decides what to render.
 */
export function AuthGate() {
  const { loading, authenticated } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!authenticated) {
    // Remember where they were going so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
