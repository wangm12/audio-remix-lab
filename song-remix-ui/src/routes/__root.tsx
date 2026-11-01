import { createRootRoute, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { TaskMonitorProvider } from "@/components/layout/TaskMonitorProvider";
import { isAuthenticated } from "@/lib/auth";

const PUBLIC_ROUTES = ["/login", "/register"];

function RootLayout() {
  const location = useLocation();
  const isPublic = PUBLIC_ROUTES.includes(location.pathname);

  return (
    <TaskMonitorProvider isEnabled={!isPublic && isAuthenticated()}>
      {isPublic ? <Outlet /> : <AppShell><Outlet /></AppShell>}
    </TaskMonitorProvider>
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
