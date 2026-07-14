"use client";

import { useActionState, useState } from "react";

import { loginAction, signupAction, type LoginState } from "./actions";

const initialState: LoginState = {};

const inputClass =
  "rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]";

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const signup = mode === "signup";

  // One hook per action so flipping the mode never rebinds a pending form.
  const [loginState, loginFormAction, loginPending] = useActionState(loginAction, initialState);
  const [signupState, signupFormAction, signupPending] = useActionState(signupAction, initialState);
  const state = signup ? signupState : loginState;
  const pending = signup ? signupPending : loginPending;

  return (
    <form action={signup ? signupFormAction : loginFormAction} className="flex flex-col gap-3">
      {signup ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--color-fg-muted)]">Name</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            required
            autoFocus
            placeholder="Ada Lovelace"
            className={inputClass}
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          required
          autoFocus={!signup}
          placeholder="you@example.com"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[var(--color-fg-muted)]">Password</span>
        <input
          type="password"
          name="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={signup ? 8 : undefined}
          className={inputClass}
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-[var(--color-brand-strong)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {signup
          ? pending
            ? "Creating account…"
            : "Create account"
          : pending
            ? "Signing in…"
            : "Sign in"}
      </button>

      <button
        type="button"
        onClick={() => setMode(signup ? "signin" : "signup")}
        className="text-xs text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-brand)]"
      >
        {signup
          ? "Already have an account? Sign in"
          : "No account yet? Create one — on a fresh install it becomes the admin"}
      </button>
    </form>
  );
}
