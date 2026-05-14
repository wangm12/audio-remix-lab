import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "@/pages/LibraryPage";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});
