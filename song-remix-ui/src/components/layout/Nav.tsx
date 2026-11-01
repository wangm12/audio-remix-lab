import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Music, Library, Settings, LogOut, Disc3, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLogout, useUser } from "@/hooks/useAuth";

const navItems = [
  { to: "/studio" as const, label: "Studio", icon: Music },
  { to: "/library" as const, label: "Library", icon: Library },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

export function Nav() {
  const location = useLocation();
  const { data: user } = useUser();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navContent = (
    <>
      <Link
        to="/studio"
        className="flex items-center gap-2 mb-8 px-2"
        onClick={() => setMobileOpen(false)}
      >
        <Disc3 className="w-7 h-7 text-brand" />
        <span className="font-display text-lg font-bold tracking-tight">
          Remix Studio
        </span>
      </Link>

      <div className="flex flex-col gap-1 flex-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              location.pathname.startsWith(to)
                ? "bg-brand/15 text-brand"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
            )}
          >
            <Icon className="w-4.5 h-4.5" />
            {label}
          </Link>
        ))}
      </div>

      {user && (
        <div className="border-t border-surface-3/50 pt-4 mt-4">
          <div className="px-3 mb-2">
            <p className="text-sm font-medium truncate">{user.username}</p>
            <p className="text-xs text-text-muted truncate">{user.email}</p>
          </div>
          <button
            onClick={() => {
              setMobileOpen(false);
              void logout();
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-error hover:bg-surface-2 w-full transition-colors"
            aria-label="Log out"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3 bg-surface-1 border-b border-surface-3/50">
        <Link to="/studio" className="flex items-center gap-2">
          <Disc3 className="w-6 h-6 text-brand" />
          <span className="font-display text-base font-bold">Remix Studio</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        >
          <nav
            className="flex flex-col h-full w-64 bg-surface-1 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {navContent}
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col h-full w-56 bg-surface-1 border-r border-surface-3/50 p-4 shrink-0">
        {navContent}
      </nav>
    </>
  );
}
