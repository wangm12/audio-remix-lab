import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { setToken, clearToken, isAuthenticated } from "@/lib/auth";
import { useNavigate } from "@tanstack/react-router";

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
  return async () => {
    try {
      await api.auth.logout();
    } catch {
      // The media cookie expires on its own; local logout must still happen.
    }
    clearToken();
    qc.clear();
    navigate({ to: "/login" });
  };
}
