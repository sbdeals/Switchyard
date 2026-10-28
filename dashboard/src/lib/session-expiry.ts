// Shared by API callers and Server Actions. Keep editors mounted on expiry.
let expired = false;
const listeners = new Set<() => void>();

export const isSessionExpired = () => expired;

export function setSessionExpired(value: boolean): void {
  if (expired === value) return;
  expired = value;
  for (const listener of listeners) listener();
}

export function subscribeSessionExpiry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
