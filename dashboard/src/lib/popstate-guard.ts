type PopstateGuard = {
  handler: ((event: PopStateEvent) => void) | null;
  replay: PopStateEvent | null;
};

declare global {
  interface Window {
    __switchyardPopstateGuard: PopstateGuard;
  }
}

// Emitted as a synchronous head script: registration must precede Next's
// hydration listener. Capture alone does not give priority at window's target.
export const POPSTATE_GUARD_SCRIPT = `
(function () {
  if (window.__switchyardPopstateGuard) return;
  var guard = window.__switchyardPopstateGuard = { handler: null, replay: null };
  window.addEventListener("popstate", function (event) {
    if (guard.handler && event !== guard.replay) guard.handler(event);
  });
})();`;

function ensureGuard(): PopstateGuard {
  // Fallback only (head script missing): later than Next, so best effort.
  if (!window.__switchyardPopstateGuard) {
    const guard: PopstateGuard = { handler: null, replay: null };
    window.__switchyardPopstateGuard = guard;
    window.addEventListener("popstate", (event) => {
      if (guard.handler && event !== guard.replay) guard.handler(event);
    });
  }
  return window.__switchyardPopstateGuard;
}

export function installPopstateGuard(handler: (event: PopStateEvent) => void) {
  const guard = ensureGuard();
  guard.handler = handler;
  return () => {
    if (guard.handler === handler) guard.handler = null;
  };
}

/** Only the accepted event bypasses the guard; Next still receives the replay. */
export function replayPopstate(event: PopStateEvent) {
  const guard = ensureGuard();
  const previous = guard.replay;
  guard.replay = event;
  try {
    window.dispatchEvent(event);
  } finally {
    guard.replay = previous;
  }
}
