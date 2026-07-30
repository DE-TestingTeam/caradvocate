import { ChevronDown } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { NavSheet, accountNavItem, primaryNavItems } from './NavSheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * Sign out lives in the Account dropdown here and in the hamburger sheet on narrow
 * screens, and it has to be in both.
 *
 * The hamburger is `lg:hidden` and this inline nav is `hidden lg:flex`, so a control in
 * only one of them is missing at half the window sizes. Sign out was in the sheet alone,
 * which meant a desktop-width window had no way to sign out at all.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link to="/my-car" className="text-lg font-bold tracking-tight">
          CarAdvocate
        </Link>

        {/* Inline nav from lg up; hamburger below. */}
        <nav className="hidden items-center gap-1 lg:flex">
          {primaryNavItems.map((item) => (
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

          <AccountMenu />
        </nav>

        <NavSheet />
      </div>
    </header>
  );
}

/**
 * Account, with Sign out nested underneath it.
 *
 * The dropdown renders in dev mode too, even though Sign out is hidden there and the
 * menu is left with a single entry. The alternative -- falling back to a plain link when
 * there is no session -- means the only automated coverage this app has (e2e, which runs
 * in dev mode) can never see the dropdown at all, and the branch that ships is the
 * untested one. A slightly redundant dev menu is a better trade.
 */
function AccountMenu() {
  const { canSignOut, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
        {accountNavItem.label}
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* navigate() rather than a nested <Link>: Radix already handles the keyboard
            and focus behaviour for an item, and wrapping one in a link fights it. */}
        <DropdownMenuItem onSelect={() => navigate(accountNavItem.to)}>
          Account settings
        </DropdownMenuItem>

        {/* Dev mode has no session to end, so there is nothing to sign out of. */}
        {canSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void signOut()}>Sign out</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
