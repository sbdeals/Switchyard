import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE, openSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

// Reads the session cookie, so it must render per request.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? Skip the form.
  const store = await cookies();
  if (openSession(store.get(SESSION_COOKIE)?.value)) {
    redirect("/");
  }

  return (
    <main className="flex min-h-full items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand)]">
            <svg viewBox="0 0 24 24" fill="none" className="size-6" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Sign in to Switchyard</h1>
          <p className="mt-1.5 text-sm text-[var(--color-fg-muted)]">
            Use your Dokploy account.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
