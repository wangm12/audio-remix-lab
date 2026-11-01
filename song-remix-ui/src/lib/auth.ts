const TOKEN_KEY = "remix_token";
const identityListeners = new Set<() => void>();

export function subscribeAuthIdentity(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => { identityListeners.delete(listener); };
}

function notifyIdentityChange(previous: string | null, next: string | null): void {
  if (previous === next) return;
  for (const listener of identityListeners) listener();
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  const previous = getToken();
  localStorage.setItem(TOKEN_KEY, token);
  notifyIdentityChange(previous, token);
}

export function clearToken(): void {
  const previous = getToken();
  localStorage.removeItem(TOKEN_KEY);
  notifyIdentityChange(previous, null);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
