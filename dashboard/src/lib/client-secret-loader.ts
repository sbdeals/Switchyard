/** Ignore secret responses after their editor or reveal control has unmounted. */
export function loadClientSecret<T>(
  request: () => Promise<T>,
  onLoaded: (value: T) => void,
  onFailed: () => void,
): () => void {
  let live = true;
  Promise.resolve().then(request).then((value) => {
    if (live) onLoaded(value);
  }).catch(() => {
    if (live) onFailed();
  });
  return () => { live = false; };
}
