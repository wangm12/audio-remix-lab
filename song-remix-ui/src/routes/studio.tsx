import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { StudioPage } from "@/pages/StudioPage";

function StudioLayout() {
  const childMatch = useMatch({ from: "/studio/$songId", shouldThrow: false });
  if (childMatch) {
    return <Outlet />;
  }
  return <StudioPage />;
}

export const Route = createFileRoute("/studio")({
  component: StudioLayout,
});
