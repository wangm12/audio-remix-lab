import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { api } from "./api";
import { setToken } from "./auth";

describe("api request helper", () => {
  it("sends the bearer token from localStorage", async () => {
    setToken("abc123");
    let authorization: string | null = null;
    server.use(
      http.get("/api/songs", ({ request }) => {
        authorization = request.headers.get("Authorization");
        return HttpResponse.json([]);
      }),
    );
    await expect(api.songs.list()).resolves.toEqual([]);
    expect(authorization).toBe("Bearer abc123");
  });

  it("surfaces the FastAPI detail message on errors", async () => {
    server.use(
      http.get("/api/songs", () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    );
    await expect(api.songs.list()).rejects.toThrow("boom");
  });
});
