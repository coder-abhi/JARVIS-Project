"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authChangedEvent, clearAuthSession, getStoredUser, type AuthUser } from "@/lib/auth";

export function AuthNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    function syncUser() {
      setUser(getStoredUser());
    }

    syncUser();
    window.addEventListener("storage", syncUser);
    window.addEventListener(authChangedEvent, syncUser);

    return () => {
      window.removeEventListener("storage", syncUser);
      window.removeEventListener(authChangedEvent, syncUser);
    };
  }, []);

  function handleLogout() {
    clearAuthSession();
    router.push("/login");
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex items-center gap-2 rounded-full bg-gray-100 p-1 text-sm font-medium text-gray-600">
        <Link href="/goals" className="rounded-full px-4 py-2 transition hover:bg-white hover:text-gray-950 hover:shadow-sm">
          Goals
        </Link>
        <Link href="/" className="rounded-full px-4 py-2 transition hover:bg-white hover:text-gray-950 hover:shadow-sm">
          Dashboard
        </Link>
        <Link href="/timeline" className="rounded-full px-4 py-2 transition hover:bg-white hover:text-gray-950 hover:shadow-sm">
          Timeline
        </Link>
        <Link href="/pomodoro" className="rounded-full px-4 py-2 transition hover:bg-white hover:text-gray-950 hover:shadow-sm">
          Pomodoro
        </Link>
        <Link href="/library" className="rounded-full px-4 py-2 transition hover:bg-white hover:text-gray-950 hover:shadow-sm">
          Library
        </Link>
      </div>

      {user ? (
        <div className="flex items-center gap-2">
          <span className="hidden max-w-36 truncate text-sm font-semibold text-gray-600 sm:inline">{user.username}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:text-gray-950"
          >
            Logout
          </button>
        </div>
      ) : (
        <Link
          href={`/login${pathname && pathname !== "/login" ? `?next=${encodeURIComponent(pathname)}` : ""}`}
          className="rounded-full bg-gray-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-gray-800"
        >
          Login
        </Link>
      )}
    </div>
  );
}
