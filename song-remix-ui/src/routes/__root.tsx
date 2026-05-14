import { createRootRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { isAuthenticated } from "@/lib/auth";

const PUBLIC_ROUTES = ["/login", "/register"];

function RootLayout() {
  const location = useLocation();
  const isPublic = PUBLIC_ROUTES.includes(location.pathname);

  if (isPublic) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export const Route = createRootRoute({
  beforeLoad: ({ location }) => {
    const isPublic = PUBLIC_ROUTES.includes(location.pathname);
    if (!isPublic && !isAuthenticated()) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootLayout,
});
