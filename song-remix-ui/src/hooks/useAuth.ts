import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { captureAuthSession, clearTokenIfCurrent, setToken, isAuthenticated } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";
import { useTaskMonitor } from "@/components/layout/TaskMonitorContext";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

export function useUser() {
  return useQuery({
    queryKey: ["user"],
    queryFn: api.auth.me,
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
      setToken(data.access_token);
      qc.invalidateQueries({ queryKey: ["user"] });
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
      setToken(data.access_token);
      qc.invalidateQueries({ queryKey: ["user"] });
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
    monitor.stopAll();
    useAudioPlayer.getState().stop();
    const request = api.auth.logout(session).catch(() => undefined);
    clearTokenIfCurrent(session);
    qc.clear();
    void navigate({ to: "/login" });
    void request;
  };
}
