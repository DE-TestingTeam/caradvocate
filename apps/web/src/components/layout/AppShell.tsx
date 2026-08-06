import { Outlet } from 'react-router-dom';
import { SideNav } from './SideNav';

/**
 * Page frame: navigation down the left, page content beside it.
 *
 * `chrome={false}` drops the navigation. Sign-in uses that, since you cannot go anywhere until
 * you are signed in. The caller passes this in rather than AppShell checking the URL, because
 * App.tsx already groups the public routes together -- so there is no list of URLs here to keep
 * in sync.
 *
 * The scroll container is `main`, not the page, so the rail stays put while content moves and
 * the collapsed rail cannot be scrolled away from on a short screen.
 */
export function AppShell({ chrome = true }: { chrome?: boolean }) {
  return (
    <div className="flex min-h-screen">
      {chrome && <SideNav />}
      <main className="h-screen flex-1 overflow-y-auto">
        {/* Content keeps its own measure, centred in whatever the rail leaves behind. */}
        <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
