import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';

/**
 * Page frame. `chrome` is false for public routes such as sign-in, where there is
 * nowhere to navigate to yet -- which branch gets nav is a property of the route
 * tree in App.tsx, not something inferred from the URL here.
 */
export function AppShell({ chrome = true }: { chrome?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col">
      {chrome && <TopBar />}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
