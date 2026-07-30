import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * NOTE: no wireframe shows the hamburger menu open, so these destinations are
 * inferred from the screens that exist.
 *
 * Account is separate from the rest because the two navs present it differently: the
 * top bar makes it a dropdown that also holds Sign out, while this sheet is already a
 * flat list and simply lists it. Keeping it a named export means neither nav has to
 * recognise it by matching on the '/account' path.
 */
export const primaryNavItems = [
  { to: '/my-car', label: 'My Car' },
  { to: '/ask', label: 'Ask CA' },
  { to: '/assessments', label: 'Repair Assessment' },
] as const;

export const accountNavItem = { to: '/account', label: 'Account' } as const;

const navItems = [...primaryNavItems, accountNavItem];

export function NavSheet() {
  const [open, setOpen] = React.useState(false);
  const { canSignOut, signOut } = useAuth();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent lg:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>Menu</SheetTitle>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <SheetClose asChild key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2.5 text-base font-medium transition-colors hover:bg-accent',
                    isActive && 'bg-accent',
                  )
                }
              >
                {item.label}
              </NavLink>
            </SheetClose>
          ))}

          {/*
            Indented under Account rather than floated to the bottom of the sheet, so it
            reads as part of the account group the way the desktop dropdown does. A
            nested dropdown inside a sheet would be two overlays deep on a phone.
            Dev mode has no session to end, so there is nothing to sign out of.
          */}
          {canSignOut && (
            <button
              type="button"
              onClick={() => void signOut()}
              className="ml-3 rounded-md px-3 py-2.5 text-left text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Sign out
            </button>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
