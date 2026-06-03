"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { login } from "@/lib/api";
import { getStoredUser, setAuthSession } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nextPath, setNextPath] = useState("/");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    setNextPath(next?.startsWith("/") ? next : "/");
    if (getStoredUser()) router.replace(next?.startsWith("/") ? next : "/");
  }, [router]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || isSaving) return;

    try {
      setIsSaving(true);
      setError(null);
      const session = await login(username.trim(), password);
      setAuthSession(session);
      router.push(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="grid min-h-[calc(100vh-7rem)] place-items-center bg-[#f4f6f3] px-5 py-10 text-stone-950">
      <form onSubmit={handleLogin} className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-xl shadow-stone-900/10">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">Welcome back</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-950">Login</h1>

        {error ? <p className="mt-5 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}

        <label className="mt-6 block text-sm font-semibold text-stone-700" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
          className="field-input mt-2"
        />

        <label className="mt-4 block text-sm font-semibold text-stone-700" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="field-input mt-2"
        />

        <button
          disabled={isSaving || !username.trim() || !password}
          className="mt-6 w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isSaving ? "Logging in..." : "Login"}
        </button>

        <p className="mt-5 text-center text-sm text-stone-600">
          New here?{" "}
          <Link href="/signup" className="font-semibold text-teal-700 transition hover:text-teal-900">
            Create an account
          </Link>
        </p>
      </form>
    </main>
  );
}
