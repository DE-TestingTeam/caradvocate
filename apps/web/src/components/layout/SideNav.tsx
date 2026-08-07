import * as React from 'react';
import { Car, ClipboardList, LogOut, MessageSquare, PanelLeftClose, PanelLeftOpen, UserRound } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import crMonogram from '@/assets/logos/cr-monogram.png';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

/**
 * The app's navigation, down the left rather than across the top.
 *
 * Two states, one of which is not the owner's to choose. Above `lg` the rail expands and
 * collapses on the toggle and the choice is remembered. Below `lg` it is always collapsed, and
 * the toggle is not rendered at all: a 240px sidebar on a phone leaves too little for the
 * content it is meant to be navigating, and a preference that survives a rotation into portrait
 * would put the owner somewhere they cannot use. Widening the window restores whatever they had
 * chosen before, so the preference is suspended rather than overwritten.
 *
 * Collapsed still means visible. The labels go to screen readers via `sr-only` and to the mouse
 * via `title`, so the rail is navigable in both cases rather than being an icon puzzle.
 */

const NAV_ITEMS = [
  { to: '/my-car', label: 'My Car', icon: Car },
  { to: '/ask', label: 'Ask CA', icon: MessageSquare },
  { to: '/assessments', label: 'Repair Assessment', icon: ClipboardList },
  { to: '/account', label: 'Account', icon: UserRound },
] as const;

/** Below this the rail is forced closed. Matches Tailwind's `lg`, so the CSS and JS agree. */
const EXPANDABLE_ABOVE = '(min-width: 1024px)';

const PREFERENCE_KEY = 'caradvocate.nav.expanded';

export function SideNav() {
  const { signOut } = useAuth();
  const canExpand = useMediaQuery(EXPANDABLE_ABOVE);
  const [preferExpanded, setPreferExpanded] = React.useState(readPreference);

  // The preference is only honoured where there is room for it.
  const expanded = canExpand && preferExpanded;

  React.useEffect(() => {
    try {
      localStorage.setItem(PREFERENCE_KEY, String(preferExpanded));
    } catch {
      // Storage disabled. The rail still works, it just forgets between visits.
    }
  }, [preferExpanded]);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r bg-background transition-[width] duration-200',
        expanded ? 'w-60' : 'w-14',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center border-b', expanded ? 'px-4' : 'justify-center')}>
        <Link
          to="/my-car"
          className="flex min-w-0 items-center gap-2"
          title="CarAdvocate"
        >
          {/*
            Supplied artwork, uncropped in the original: the mark occupies about 1621x989 of a
            2000px square, so sizing the file as-is would render it a third the height it looks.
            The asset here is trimmed to the mark and sized by height, which is why it is `h-6
            w-auto` rather than a square.

            `alt=""` on purpose. Expanded it sits beside the word it stands for, and collapsed
            the word is still there for screen readers below -- announcing "Consumer Reports"
            twice, or once as a logo and once as a name, is noise either way.
          */}
          <img src={crMonogram} alt="" className="h-6 w-auto shrink-0" />
          {/* Collapsed, the mark is the whole lockup; the name stays for screen readers. */}
          <span className={cn('truncate text-lg font-bold tracking-tight', !expanded && 'sr-only')}>
            CarAdvocate
          </span>
        </Link>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              title={expanded ? undefined : item.label}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  expanded ? 'px-3' : 'justify-center px-0',
                  isActive && 'bg-accent text-foreground',
                )
              }
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className={cn('truncate', !expanded && 'sr-only')}>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="shrink-0 space-y-1 border-t p-2">
        <button
          type="button"
          onClick={() => void signOut()}
          title={expanded ? undefined : 'Sign out'}
          className={cn(
            'flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            expanded ? 'px-3' : 'justify-center px-0',
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className={cn('truncate', !expanded && 'sr-only')}>Sign out</span>
        </button>

        {/*
          Only where the choice is real. Rendering a disabled toggle below `lg` would advertise
          a control that does nothing, which is worse than not offering it.
        */}
        {canExpand && (
          <button
            type="button"
            onClick={() => setPreferExpanded((was) => !was)}
            aria-expanded={expanded}
            title={expanded ? 'Collapse menu' : 'Expand menu'}
            className={cn(
              'flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              expanded ? 'px-3' : 'justify-center px-0',
            )}
          >
            {expanded ? (
              <PanelLeftClose className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span className={cn('truncate', !expanded && 'sr-only')}>Collapse menu</span>
          </button>
        )}
      </div>
    </nav>
  );
}

function readPreference(): boolean {
  try {
    // Expanded unless they have said otherwise -- a first visit should show the labels.
    return localStorage.getItem(PREFERENCE_KEY) !== 'false';
  } catch {
    return true;
  }
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
