import { Outlet } from 'react-router-dom';
import { SideNav } from './SideNav';

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
        <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 lg:pt-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
