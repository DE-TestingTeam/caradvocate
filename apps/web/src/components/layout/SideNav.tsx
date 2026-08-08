import * as React from 'react';
import { Car, ClipboardList, LogOut, Menu, MessageSquare, UserRound } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import crMonogram from '@/assets/logos/cr-monogram.png';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * The app's navigation, in two shapes.
 *
 * At `lg` and above it is a fixed rail down the left with its labels always showing. Below `lg` it
 * becomes a top bar with a hamburger, and the destinations move into a sheet that slides over the
 * content.
 *
 * The narrow case is a sheet rather than a permanent icon rail because a rail costs its width on
 * every screen, and on a phone that width is taken from the content the rail exists to navigate.
 * A sheet costs nothing until it is asked for. It also means the labels are always readable there
 * -- an icon-only rail is at its worst on the device where nobody can hover to find out what an
 * icon means.
 *
 * One breakpoint governs both, so there is no width at which the rail and the top bar disagree
 * about which of them is in charge.
 */

const NAV_ITEMS = [
  { to: '/my-car', label: 'My Car', icon: Car },
  { to: '/ask', label: 'Ask CA', icon: MessageSquare },
  /**
   * "Repairs", not "Repair Assessment". It is what someone would say out loud, and the screen
   * can explain that it is an assessment once they are on it. The route is unchanged.
   */
  { to: '/assessments', label: 'Repairs', icon: ClipboardList },
  { to: '/account', label: 'Account', icon: UserRound },
] as const;

/** Rail at and above this, hamburger below it. Matches Tailwind's `lg`, so CSS and JS agree. */
const RAIL_ABOVE = '(min-width: 1024px)';

/**
 * Shared by every row in both shapes, so the rail and the sheet cannot drift apart.
 *
 * Active rows take the brand green. With primary actions now in near-black, "where you are" is
 * one of the few jobs the house colour still holds, and it should mean the same thing in the
 * rail and in the sheet.
 */
function rowClass(active = false) {
  return cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
    active && 'bg-brand/10 text-brand hover:bg-brand/10 hover:text-brand',
  );
}

export function SideNav() {
  const { signOut } = useAuth();
  const showRail = useMediaQuery(RAIL_ABOVE);
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Rotating a phone into landscape can cross the breakpoint mid-session. Without this the sheet
  // stays mounted in state and reopens over the rail the next time the window narrows.
  React.useEffect(() => {
    if (showRail) setMenuOpen(false);
  }, [showRail]);

  if (!showRail) {
    return (
      <>
        {/* Translucent with a blur, so content scrolling underneath stays faintly visible
            rather than disappearing behind a hard edge. */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/90 px-2 backdrop-blur">
          {/* Brand first in the markup as well as on screen, so the tab order runs left to
              right rather than jumping to the control on the far side. */}
          <Link to="/my-car" className="flex min-w-0 items-center gap-2 pl-1" title="CarAdvocate">
            <img src={crMonogram} alt="" className="h-6 w-auto shrink-0" />
            <span className="truncate text-lg font-bold tracking-tight">CarAdvocate</span>
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            // 40px square: the smallest comfortable touch target, and the one control on this
            // bar that has to be hittable with a thumb.
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          {/* Enters from the right, the side its hamburger sits on -- a panel that crossed the
              screen to arrive from the opposite edge would not read as belonging to the control
              that opened it.

              `p-0` so the rows can run edge to edge under their own padding, the way they do in
              the rail. Radix needs a title even when the design has no room to show one. */}
          <SheetContent side="right" className="w-72 gap-0 p-0">
            <SheetTitle className="sr-only">Main menu</SheetTitle>

            <nav aria-label="Main" className="flex h-full flex-col">
              <div className="flex h-14 shrink-0 items-center border-b px-4">
                <img src={crMonogram} alt="" className="h-6 w-auto shrink-0" />
                <span className="ml-2 truncate text-lg font-bold tracking-tight">CarAdvocate</span>
              </div>

              {/* Every tap here navigates, and a menu still sitting over the page it just moved
                  you to reads as though the tap missed. */}
              <NavList onNavigate={() => setMenuOpen(false)} />

              <div className="shrink-0 border-t p-2">
                <SignOutButton
                  onSignOut={() => {
                    setMenuOpen(false);
                    void signOut();
                  }}
                />
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <nav
      aria-label="Main"
      className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-background"
    >
      <div className="flex h-14 shrink-0 items-center border-b px-4">
        <Link to="/my-car" className="flex min-w-0 items-center gap-2" title="CarAdvocate">
          {/*
            Supplied artwork, uncropped in the original: the mark occupies about 1621x989 of a
            2000px square, so sizing the file as-is would render it a third the height it looks.
            The asset here is trimmed to the mark and sized by height, which is why it is `h-6
            w-auto` rather than a square.

            `alt=""` on purpose. It sits beside the word it stands for, and announcing the name
            once as a logo and once as text is noise.
          */}
          <img src={crMonogram} alt="" className="h-6 w-auto shrink-0" />
          <span className="truncate text-lg font-bold tracking-tight">CarAdvocate</span>
        </Link>
      </div>

      <NavList />

      <div className="shrink-0 border-t p-2">
        <SignOutButton onSignOut={() => void signOut()} />
      </div>
    </nav>
  );
}

/** The destinations. Labelled in both shapes, so neither is an icon puzzle. */
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <ul className="flex-1 space-y-1 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => (
        <li key={item.to}>
          <NavLink to={item.to} onClick={onNavigate} className={({ isActive }) => rowClass(isActive)}>
            <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

function SignOutButton({ onSignOut }: { onSignOut: () => void }) {
  return (
    <button type="button" onClick={onSignOut} className={rowClass()}>
      <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="truncate">Sign out</span>
    </button>
  );
}

/**
 * Tracks a media query in state.
 *
 * `matchMedia` rather than a resize listener: the browser already knows when the answer changes
 * and says so, where a resize handler recomputes on every pixel of a drag. Guarded because
 * non-browser environments do not have it.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(query).matches === true,
  );

  React.useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;

    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
