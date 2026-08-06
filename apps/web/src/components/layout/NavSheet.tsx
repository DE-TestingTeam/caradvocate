import * as React from "react";
import { NavLink } from "react-router-dom";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const primaryNavItems = [
  { to: "/my-car", label: "My Car" },
  { to: "/ask", label: "Ask CA" },
  { to: "/assessments", label: "Repair Assessment" },
] as const;

export const accountNavItem = { to: "/account", label: "Account" } as const;

const navItems = [...primaryNavItems, accountNavItem];

export function NavSheet() {
  const [open, setOpen] = React.useState(false);
  const { signOut } = useAuth();

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
                    "rounded-md px-3 py-2.5 text-base font-medium transition-colors hover:bg-accent",
                    isActive && "bg-accent",
                  )
                }
              >
                {item.label}
              </NavLink>
            </SheetClose>
          ))}
          <button
            type="button"
            onClick={() => void signOut()}
            className="ml-3 rounded-md px-3 py-2.5 text-left text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Sign out
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
