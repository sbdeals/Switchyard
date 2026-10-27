import { describe, expect, it, vi } from "vitest";
import { loadClientSecret } from "./client-secret-loader";

describe("client secret loading", () => {
  it("loads the requested secret only into the active editor", async () => {
    const loaded = vi.fn();
    const failed = vi.fn();
    loadClientSecret(async () => ({ command: "TOKEN=sentinel node app.js" }), loaded, failed);

    await vi.waitFor(() => expect(loaded).toHaveBeenCalledWith({ command: "TOKEN=sentinel node app.js" }));
    expect(failed).not.toHaveBeenCalled();
  });

  it("ignores a response after the editor unmounts or changes service", async () => {
    const loaded = vi.fn();
    const failed = vi.fn();
    let resolve!: (secret: string) => void;
    const request = new Promise<string>((done) => { resolve = done; });
    const cancel = loadClientSecret(() => request, loaded, failed);
    cancel();
    resolve("sentinel");

    await new Promise((done) => setTimeout(done, 0));
    expect(loaded).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it.each([false, true])("handles a rejected or thrown request without forwarding its error (sync: %s)", async (sync) => {
    const loaded = vi.fn();
    const failed = vi.fn();
    loadClientSecret(() => {
      if (sync) throw new Error("backend leaked sentinel");
      return Promise.reject(new Error("backend leaked sentinel"));
    }, loaded, failed);

    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith());
    expect(loaded).not.toHaveBeenCalled();
  });

  it("ignores a failed request after cancellation", async () => {
    const loaded = vi.fn();
    const failed = vi.fn();
    let reject!: (error: Error) => void;
    const request = new Promise<string>((_, fail) => { reject = fail; });
    const cancel = loadClientSecret(() => request, loaded, failed);
    cancel();
    reject(new Error("backend leaked sentinel"));

    await new Promise((done) => setTimeout(done, 0));
    expect(loaded).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
