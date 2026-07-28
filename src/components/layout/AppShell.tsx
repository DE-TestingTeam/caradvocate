import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-16 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
