import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { captureAuthSession, clearTokenIfCurrent, setToken, isAuthenticated } from "@/lib/auth";
import { beginAuthIntent, isAuthIntentCurrent } from "@/lib/auth-cookie-writers";
import { useNavigate } from "@tanstack/react-router";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

export function useUser() {
  return useQuery({
    queryKey: ["user"],
    queryFn: ({ signal }) => api.auth.me(signal),
    enabled: isAuthenticated(),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.auth.login,
    onSuccess: (data) => {
      if (!isAuthIntentCurrent(data.authIntent)) return;
      setToken(data.access_token);
      if (!isAuthIntentCurrent(data.authIntent)) return;
      qc.invalidateQueries({ queryKey: ["user"] });
      if (!isAuthIntentCurrent(data.authIntent)) return;
      navigate({ to: "/studio" });
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: api.auth.register,
    onSuccess: (data) => {
      if (!isAuthIntentCurrent(data.authIntent)) return;
      setToken(data.access_token);
      if (!isAuthIntentCurrent(data.authIntent)) return;
      qc.invalidateQueries({ queryKey: ["user"] });
      if (!isAuthIntentCurrent(data.authIntent)) return;
      navigate({ to: "/studio" });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const monitor = useTaskMonitor();
  return () => {
    const session = captureAuthSession();
    const intent = beginAuthIntent();
    monitor.stopAll();
    useAudioPlayer.getState().stop();
    const request = api.auth.logout(session, intent).catch(() => undefined);
    clearTokenIfCurrent(session);
    qc.clear();
    void navigate({ to: "/login" });
    void request;
  };
}
