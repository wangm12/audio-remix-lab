import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useUser } from "@/hooks/useAuth";
import { CheckCircle2, XCircle } from "lucide-react";

export function SettingsPage() {
  const { data: user } = useUser();
  const { data: engines } = useQuery({
    queryKey: ["engines"],
    queryFn: api.engines.status,
  });

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="font-display text-3xl font-bold mb-8">Settings</h1>

      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-4">Account</h2>
        <div className="p-4 bg-surface-1 border border-surface-3 rounded-xl space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Username</span>
            <span>{user?.username}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Email</span>
            <span>{user?.email}</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold mb-4">
          Engine status
        </h2>
        <div className="space-y-3">
          {engines?.health.map((h) => (
            <div
              key={h.engine}
              className="flex items-center justify-between p-4 bg-surface-1 border border-surface-3 rounded-xl"
            >
              <div>
                <span className="text-sm font-medium capitalize">
                  {h.engine}
                </span>
                {h.error && (
                  <p className="text-xs text-text-muted mt-0.5">{h.error}</p>
                )}
              </div>
              {h.healthy ? (
                <CheckCircle2 className="w-5 h-5 text-success" />
              ) : (
                <XCircle className="w-5 h-5 text-error" />
              )}
            </div>
          ))}
          {!engines?.health.length && (
            <p className="text-sm text-text-muted">No engines configured.</p>
          )}
        </div>
      </section>
    </div>
  );
}
