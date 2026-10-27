import { describe, expect, it } from "vitest";
import { MAX_FILE_CONTENT_BYTES, validateMount, type MountInput } from "./mounts";

const volume = { type: "volume", mountPath: "/data", volumeName: "app-data" };
const file = { type: "file", mountPath: "/etc/app.conf", filePath: "app.conf", content: "hello\n" };

describe("validateMount", () => {
  it("accepts named volumes and files, including empty file content", () => {
    expect(validateMount(volume, [])).toBeNull();
    expect(validateMount(file, [])).toBeNull();
    expect(validateMount({ ...file, content: "" }, [])).toBeNull();
  });

  it.each(["bind", "unknown", "", undefined, null, 1, {}, []])("rejects unsupported mount type %j", (type) => {
    expect(validateMount({ ...volume, type }, [])).toBe("Choose a named volume or file mount.");
  });

  it.each([undefined, null, 1, "volume", [], true])("rejects malformed runtime payload %j", (input) => {
    expect(validateMount(input as MountInput, [])).toBe("Choose a named volume or file mount.");
  });

  it.each(["", "data", "./data", "C:\\data", "/data\0", "/data\n", "/data\t", "/data\u007f", "/data\u0085", null, undefined, 1, {}, []])("rejects invalid mount path %j", (mountPath) => {
    expect(validateMount({ ...volume, mountPath }, [])).toBe("Mount path must be an absolute path without control characters.");
  });

  it.each(["/", "/data", "/data/", "//data", "/data/./", "/tmp/../data", "/data with spaces/配置"])('accepts absolute Linux mount path "%s"', (mountPath) => {
    expect(validateMount({ ...volume, mountPath }, [])).toBeNull();
  });

  it.each(["/data", "/data/", "//data", "/data/./", "/data/../data", "/../../data"])('rejects duplicate destination "%s"', (mountPath) => {
    expect(validateMount({ ...volume, mountPath }, [{ mountId: "existing", mountPath: "/data" }])).toBe("A mount already uses this path.");
  });

  it("canonicalizes existing destinations and checks duplicates for both mount types", () => {
    const existing = [{ mountId: "existing", mountPath: "//data/./" }];
    expect(validateMount(volume, existing)).toBe("A mount already uses this path.");
    expect(validateMount({ ...file, mountPath: "/data" }, existing)).toBe("A mount already uses this path.");
    expect(validateMount({ ...volume, mountPath: "/database" }, existing)).toBeNull();
  });

  it("allows an unchanged destination while editing, but still checks other mounts", () => {
    const existing = [{ mountId: "self", mountPath: "/data/" }, { mountId: "other", mountPath: "/backup" }];
    expect(validateMount(volume, existing, "self")).toBeNull();
    expect(validateMount({ ...volume, mountPath: "/backup" }, existing, "self")).toBe("A mount already uses this path.");
    expect(validateMount(volume, existing, "missing")).toBe("A mount already uses this path.");
  });

  it.each(["ab", "0A", "app_data-1.2", "A."])('accepts Docker volume name "%s"', (volumeName) => {
    expect(validateMount({ ...volume, volumeName }, [])).toBeNull();
  });

  it.each(["", "a", "_app", ".app", "-app", "app/data", "app\\data", "app data", "äpp", "app\n", null, undefined, 1, {}, []])("rejects invalid Docker volume name %j", (volumeName) => {
    expect(validateMount({ ...volume, volumeName }, [])).toBe("Volume name must have at least two characters, start with a letter or number, and use only letters, numbers, underscores, dots, or hyphens.");
  });

  it.each(["app.conf", ".env", "my config.txt", "配置.json"])('accepts safe file basename "%s"', (filePath) => {
    expect(validateMount({ ...file, filePath }, [])).toBeNull();
  });

  it.each(["", ".", "..", "../config", "nested/config", "/config", "..\\config", "nested\\config", "config\0", "config\r", "config\u007f", "config\u0085", null, undefined, 1, {}, []])("rejects unsafe file basename %j", (filePath) => {
    expect(validateMount({ ...file, filePath }, [])).toBe("File name must be a single name without slashes or control characters.");
  });

  it.each([null, undefined, 1, {}, [], true])("rejects non-text file content %j", (content) => {
    expect(validateMount({ ...file, content }, [])).toBe("File content must be text.");
  });

  it("caps file content at 64 KiB measured as UTF-8 bytes", () => {
    expect(MAX_FILE_CONTENT_BYTES).toBe(64 * 1024);
    expect(validateMount({ ...file, content: "a".repeat(MAX_FILE_CONTENT_BYTES) }, [])).toBeNull();
    expect(validateMount({ ...file, content: "a".repeat(MAX_FILE_CONTENT_BYTES + 1) }, [])).toBe("File content must be 64 KiB or smaller.");
    expect(validateMount({ ...file, content: "😀".repeat(MAX_FILE_CONTENT_BYTES / 4) }, [])).toBeNull();
    expect(validateMount({ ...file, content: "😀".repeat(MAX_FILE_CONTENT_BYTES / 4) + "a" }, [])).toBe("File content must be 64 KiB or smaller.");
    expect(validateMount({ ...file, content: "é".repeat(MAX_FILE_CONTENT_BYTES / 2) }, [])).toBeNull();
    expect(validateMount({ ...file, content: "é".repeat(MAX_FILE_CONTENT_BYTES / 2) + "é" }, [])).toBe("File content must be 64 KiB or smaller.");
  });

  it("returns a fixed size error without echoing file content", () => {
    const content = "private-file-content".repeat(MAX_FILE_CONTENT_BYTES);
    expect(validateMount({ ...file, content }, [])).toBe("File content must be 64 KiB or smaller.");
  });
});
