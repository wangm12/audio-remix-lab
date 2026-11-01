const TOKEN_KEY = "remix_token";
const identityListeners = new Set<() => void>();
let identityEpoch = 0;

export interface AuthSessionLease {
  token: string | null;
  epoch: number;
}

export function captureAuthSession(): AuthSessionLease {
  return { token: getToken(), epoch: identityEpoch };
}

export function isAuthSessionCurrent(session: AuthSessionLease): boolean {
  return session.epoch === identityEpoch && session.token === getToken();
}

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
  if (previous !== token) identityEpoch += 1;
  notifyIdentityChange(previous, token);
}

export function clearToken(): void {
  const previous = getToken();
  localStorage.removeItem(TOKEN_KEY);
  if (previous !== null) identityEpoch += 1;
  notifyIdentityChange(previous, null);
}

export function clearTokenIfCurrent(session: AuthSessionLease): boolean {
  if (!session.token || !isAuthSessionCurrent(session)) return false;
  clearToken();
  return true;
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
