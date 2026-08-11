import { Outlet, useLocation } from 'react-router-dom';
import { SideNav } from './SideNav';
import { cn } from '@/lib/utils';

/**
 * Page frame: navigation beside the page content on a wide screen, above it on a narrow one.
 *
 * The axis flips at `lg` because SideNav changes shape there -- a rail to the left of the content
 * above it, a top bar stacked over the content below it. SideNav owns which shape it renders;
 * this only decides where the shape goes.
 *
 * `chrome={false}` drops the navigation. Sign-in uses that, since you cannot go anywhere until
 * you are signed in. The caller passes this in rather than AppShell checking the URL, because
 * App.tsx already groups the public routes together -- so there is no list of URLs here to keep
 * in sync.
 *
 * The scroll container is `main`, not the page, so the navigation stays put while content moves
 * and cannot be scrolled away from on a short screen. That needs `min-h-0`: a flex child defaults
 * to a floor of its content's height, which would let `main` outgrow the screen and hand the
 * scrolling back to the page.
 */
export function AppShell({ chrome = true }: { chrome?: boolean }) {
  /*
   * My Car gets a WIDER cap than the rest, not no cap at all. It is the one page laid out as a
   * dashboard -- a two-thirds/one-third grid plus a four-stat strip -- and those panels do put
   * extra width to work, which is why `max-w-5xl` is wrong for it. But uncapped was wrong too:
   * on a 2000px content area the masthead opened a 700px hole between the car's name and the
   * button on the far right, and every attention row put its title at one edge of the screen
   * and its action at the other, so connecting the two meant crossing the whole display.
   *
   * `max-w-[1440px]` is where the two-column grid still has a real sidebar and a row is still
   * readable end to end. The other pages are single columns of panels and prose and keep the
   * narrower measure; widening them would just stretch line lengths.
   *
   * Checked here by URL, which is the exception to the note on `chrome` below -- one route in
   * one place, against `chrome`'s whole route groups.
   */
  const { pathname } = useLocation();
  const wide = pathname === '/my-car';

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {chrome && <SideNav />}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {/*
          Content keeps its own measure, centred in whatever the rail leaves behind.

          `max-w-5xl` (1024px), up from `max-w-3xl` (768px): 768px is a comfortable measure for
          a single column of prose, but every screen here is really a set of panels, and at the
          old width they could only ever stack. The wider column lets them sit two-up from `md`
          without the text inside any one of them running long, because each panel now sets its
          own measure rather than inheriting the page's.
        */}
        {/* The dashboard breathes a little more at its edges from `lg`, since there is no
            longer a margin doing that job for it. */}
        <div
          className={cn(
            'mx-auto w-full px-4 pb-16 pt-6 lg:pt-10',
            wide ? 'max-w-[1440px] lg:px-8' : 'max-w-5xl',
          )}
        >
          <Outlet />
        </div>
      </main>
    </div>
  );
}
