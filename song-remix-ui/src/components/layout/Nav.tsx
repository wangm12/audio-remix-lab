import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Music, Library, Settings, LogOut, Disc3, Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLogout, useUser } from "@/hooks/useAuth";

const navItems = [
  { to: "/studio" as const, label: "Studio", icon: Music },
  { to: "/library" as const, label: "Library", icon: Library },
  { to: "/settings" as const, label: "Settings", icon: Settings },
];

export function Nav({ onMobileOpenChange }: { onMobileOpenChange?: (open: boolean) => void } = {}) {
  const location = useLocation();
  const { data: user } = useUser();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousPathRef = useRef(location.pathname);
  const routeChangePendingRef = useRef(false);

  const focusRouteTarget = () => {
    const target = document.querySelector<HTMLElement>("main h1, main [data-route-focus], main input, h1, form input");
    if (target) { target.tabIndex = -1; target.focus(); }
  };

  const closeForRoute = (to: string) => {
    if (mobileOpen && location.pathname.startsWith(to)) {
      routeChangePendingRef.current = false;
      closeMenu(false);
      requestAnimationFrame(focusRouteTarget);
      return;
    }
    routeChangePendingRef.current = true;
    setMobileOpen(false);
  };

  const closeMenu = (returnFocus = true) => {
    setMobileOpen(false);
    if (returnFocus) requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
  };

  useEffect(() => onMobileOpenChange?.(mobileOpen), [mobileOpen, onMobileOpenChange]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 768px)");
    const handleChange = (event: MediaQueryListEvent) => { if (event.matches) closeMenu(false); };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (previousPathRef.current === location.pathname) return;
    previousPathRef.current = location.pathname;
    if (routeChangePendingRef.current) {
      routeChangePendingRef.current = false;
      requestAnimationFrame(focusRouteTarget);
      return;
    }
    if (!mobileOpen) return;
    requestAnimationFrame(() => {
      setMobileOpen(false);
      requestAnimationFrame(focusRouteTarget);
    });
  }, [location.pathname, mobileOpen]);

  useEffect(() => { if (mobileOpen) closeRef.current?.focus(); }, [mobileOpen]);

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(); return; }
    if (event.key !== "Tab") return;
    const dialog = event.currentTarget;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'));
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  };

  const navContent = (
    <>
      <Link
        to="/studio"
        className="flex items-center gap-2 mb-8 px-2"
        onClick={() => closeForRoute("/studio")}
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
            onClick={() => closeForRoute(to)}
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
              routeChangePendingRef.current = true;
              closeMenu(false);
              void logout();
              window.setTimeout(focusRouteTarget, 0);
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
      <div inert={mobileOpen} aria-hidden={mobileOpen} className="md:hidden fixed top-0 left-0 right-0 z-[70] flex items-center justify-between px-4 py-3 bg-surface-1 border-b border-surface-3/50">
        <Link to="/studio" className="flex items-center gap-2">
          <Disc3 className="w-6 h-6 text-brand" />
          <span className="font-display text-base font-bold">Remix Studio</span>
        </Link>
        <button
          ref={openerRef}
          onClick={() => setMobileOpen(true)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation-dialog"
          aria-haspopup="dialog"
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-[60] bg-black/50"
          onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}
          onKeyDown={trapFocus}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation menu"
          id="mobile-navigation-dialog"
          tabIndex={-1}
        >
          <nav
            aria-label="Mobile navigation"
            className="absolute top-14 bottom-0 left-0 flex flex-col h-[calc(100%-3.5rem)] w-64 bg-surface-1 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <span className="font-display text-lg font-bold">Navigation</span>
              <button ref={closeRef} type="button" onClick={() => closeMenu()} className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-2" aria-label="Close menu">
                <X className="w-5 h-5" />
              </button>
            </div>
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
