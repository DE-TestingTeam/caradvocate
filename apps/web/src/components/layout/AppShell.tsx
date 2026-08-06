import { Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";

/**
 * Page frame: nav bar on top, page content below.
 *
 * `chrome={false}` drops the nav bar. Sign-in uses that, since you cannot go
 * anywhere until you are signed in. The caller passes this in rather than
 * AppShell checking the URL, because App.tsx already groups the public routes
 * together -- so there is no list of URLs here to keep in sync.
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
