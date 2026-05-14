import { createFileRoute } from "@tanstack/react-router";
import { SongStudioPage } from "@/pages/SongStudioPage";

export const Route = createFileRoute("/studio/$songId")({
  component: SongStudioPage,
});
