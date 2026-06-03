export type AuthUser = {
  id: string;
  username: string;
  created_at: string;
};

export type AuthSession = {
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

const tokenKey = "personal-project-manager:auth-token";
const userKey = "personal-project-manager:auth-user";
export const authChangedEvent = "personal-project-manager:auth-changed";

export function getAuthToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenKey);
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;

  const savedUser = window.localStorage.getItem(userKey);
  if (!savedUser) return null;

  try {
    return JSON.parse(savedUser) as AuthUser;
  } catch {
    window.localStorage.removeItem(userKey);
    return null;
  }
}

export function setAuthSession(session: AuthSession) {
  window.localStorage.setItem(tokenKey, session.access_token);
  window.localStorage.setItem(userKey, JSON.stringify(session.user));
  announceAuthChange();
}

export function clearAuthSession() {
  window.localStorage.removeItem(tokenKey);
  window.localStorage.removeItem(userKey);
  announceAuthChange();
}

export function getScopedStorageKey(baseKey: string) {
  const user = getStoredUser();
  return user ? `${baseKey}:${user.id}` : baseKey;
}

function announceAuthChange() {
  window.dispatchEvent(new Event(authChangedEvent));
}
