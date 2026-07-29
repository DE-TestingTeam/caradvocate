import { Link, NavLink } from 'react-router-dom';
import { NavSheet, navItems } from './NavSheet';
import { cn } from '@/lib/utils';

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link to="/my-car" className="text-lg font-bold tracking-tight">
          CarAdvocate
        </Link>

        {/* Inline nav from lg up; hamburger below. */}
        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive && 'bg-accent text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <NavSheet />
      </div>
    </header>
  );
}
