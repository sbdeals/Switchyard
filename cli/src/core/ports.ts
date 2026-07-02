import net from "node:net";

/**
 * Can we bind this port? Binding 0.0.0.0 collides with anything already
 * listening on the port for any interface, which is the conflict we care
 * about for published container ports.
 */
export function portFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => {
      srv.close(() => resolve(true));
    });
  });
}

/** First free port at or above `start` (scans up to 100 candidates). */
export async function nextFreePort(start: number, host = "0.0.0.0"): Promise<number | null> {
  for (let p = start; p < start + 100 && p <= 65535; p++) {
    if (await portFree(p, host)) return p;
  }
  return null;
}
