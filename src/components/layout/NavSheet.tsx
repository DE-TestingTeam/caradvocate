import * as React from 'react';
import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/**
 * NOTE: no wireframe shows the hamburger menu open, so these four destinations
 * are inferred from the screens that exist.
 */
export const navItems = [
  { to: '/my-car', label: 'My Car' },
  { to: '/ask', label: 'Ask CA' },
  { to: '/assessments', label: 'Repair Assessment' },
  { to: '/account', label: 'Account' },
] as const;

export function NavSheet() {
  const [open, setOpen] = React.useState(false);

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
        </nav>
      </SheetContent>
    </Sheet>
  );
}
