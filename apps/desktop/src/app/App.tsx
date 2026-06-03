import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import PomodoroCompletionToast from "@/components/PomodoroCompletionToast";
import { authChangedEvent, clearAuthSession, getStoredUser, type AuthUser } from "@/lib/auth";
import { sidebarItems } from "./featureRegistry";
import { useEffect, useState } from "react";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(() => getStoredUser());
  const isAuthScreen = location.pathname === "/login" || location.pathname === "/signup";

  useEffect(() => {
    function syncUser() {
      setUser(getStoredUser());
    }

    window.addEventListener("storage", syncUser);
    window.addEventListener(authChangedEvent, syncUser);
    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener(authChangedEvent, syncUser);
    };
  }, []);

  function logout() {
    clearAuthSession();
    navigate("/login");
  }

  return (
    <div className="desktop-shell">
      {!isAuthScreen ? (
        <aside className="desktop-sidebar">
          <Link to="/" className="brand-lockup">
            <span className="brand-mark">J</span>
            <span>
              <strong>Jarvis</strong>
              <small>Local command center</small>
            </span>
          </Link>

          <nav className="sidebar-nav" aria-label="Jarvis features">
            {sidebarItems.map((item) => {
              const active = item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
              return (
                <Link key={item.path} to={item.path} className={active ? "active" : undefined}>
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <span className="truncate">{user?.username ?? "Not signed in"}</span>
            {user ? (
              <button type="button" onClick={logout}>
                Logout
              </button>
            ) : (
              <Link to="/login">Login</Link>
            )}
          </div>
        </aside>
      ) : null}

      <section className={isAuthScreen ? "auth-content" : "desktop-content"}>
        <Outlet />
      </section>
      <PomodoroCompletionToast />
    </div>
  );
}
