"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { signup } from "@/lib/api";
import { setAuthSession } from "@/lib/auth";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || isSaving) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      const session = await signup(username.trim(), password);
      setAuthSession(session);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="grid min-h-[calc(100vh-7rem)] place-items-center bg-[#f4f6f3] px-5 py-10 text-stone-950">
      <form onSubmit={handleSignup} className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-xl shadow-stone-900/10">
        <p className="text-sm font-semibold uppercase tracking-wide text-teal-700">New account</p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-950">Sign up</h1>

        {error ? <p role="alert" className="mt-5 rounded-md bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p> : null}

        <label className="mt-6 block text-sm font-semibold text-stone-700" htmlFor="signup-username">
          Username
        </label>
        <input
          id="signup-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          required
          minLength={3}
          autoFocus
          className="field-input mt-2"
        />

        <label className="mt-4 block text-sm font-semibold text-stone-700" htmlFor="signup-password">
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className="field-input mt-2"
        />

        <label className="mt-4 block text-sm font-semibold text-stone-700" htmlFor="confirm-password">
          Confirm password
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
          className="field-input mt-2"
        />

        <button
          disabled={isSaving || !username.trim() || !password || !confirmPassword}
          className="mt-6 w-full rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {isSaving ? "Creating..." : "Create Account"}
        </button>

        <p className="mt-5 text-center text-sm text-stone-600">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-teal-700 transition hover:text-teal-900">
            Login
          </Link>
        </p>
      </form>
    </main>
  );
}
