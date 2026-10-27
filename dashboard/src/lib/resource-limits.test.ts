import { describe, expect, it } from "vitest";
import { parseResources, resourceInputs, resourcePreset, RESOURCE_PRESETS, type ResourceInputs, type StoredResources } from "./resource-limits";

const empty: ResourceInputs = { cpuLimit: "", cpuReservation: "", memoryLimit: "", memoryReservation: "" };
const unset: StoredResources = { cpuLimit: null, cpuReservation: null, memoryLimit: null, memoryReservation: null };

describe("resource unit conversion", () => {
  it("stores Small as integer nanocpus and bytes", () => {
    const stored = { ...unset, cpuLimit: "500000000", memoryLimit: "536870912" };
    expect(parseResources(RESOURCE_PRESETS.Small)).toEqual(stored);
    expect(resourceInputs(stored)).toEqual(RESOURCE_PRESETS.Small);
  });

  it("converts cores and both binary memory units, including reservations", () => {
    expect(parseResources({ cpuLimit: "1.5", cpuReservation: ".25", memoryLimit: "1.5 gib", memoryReservation: "512 mib" })).toEqual({
      cpuLimit: "1500000000", cpuReservation: "250000000", memoryLimit: "1610612736", memoryReservation: "536870912",
    });
    expect(parseResources({ ...empty, memoryLimit: "512" }).memoryLimit).toBe("536870912");
  });

  it("treats empty and whitespace values as unset", () => {
    expect(parseResources(empty)).toEqual(unset);
    expect(parseResources({ cpuLimit: " ", cpuReservation: "\n", memoryLimit: "\t", memoryReservation: " " })).toEqual(unset);
    expect(resourceInputs(unset)).toEqual(empty);
    expect(resourceInputs({ cpuLimit: "", cpuReservation: " ", memoryLimit: "", memoryReservation: "\n" })).toEqual(empty);
  });

  it.each([
    { cpuLimit: "10000000", cpuReservation: null, memoryLimit: "6291456", memoryReservation: null },
    { cpuLimit: "256000000000", cpuReservation: "256000000000", memoryLimit: "1099511627776", memoryReservation: "1099511627776" },
    { cpuLimit: "300000000", cpuReservation: "100000001", memoryLimit: "1073741825", memoryReservation: "6291457" },
    { cpuLimit: "500000001", cpuReservation: "123456789", memoryLimit: "536870913", memoryReservation: "100000000" },
  ])("round-trips valid stored integers exactly: %j", (stored) => {
    expect(parseResources(resourceInputs(stored))).toEqual(stored);
  });

  it("normalizes harmless stored whitespace and leading zeroes", () => {
    expect(parseResources(resourceInputs({ ...unset, cpuLimit: " 0500000000 ", memoryLimit: "0536870912" }))).toEqual({
      ...unset, cpuLimit: "500000000", memoryLimit: "536870912",
    });
  });
});

describe("resource validation", () => {
  it.each([null, undefined, "0.5", 1, [], true])("rejects a malformed input object: %j", (input) => {
    expect(() => parseResources(input as unknown as ResourceInputs)).toThrow("Resources must be an object with CPU and memory fields.");
  });

  it.each([null, undefined, 0.5, {}, [], true])("rejects non-text fields: %j", (value) => {
    for (const field of Object.keys(empty) as (keyof ResourceInputs)[]) {
      expect(() => parseResources({ ...empty, [field]: value } as ResourceInputs)).toThrow("must be text; leave it empty to unset it.");
    }
  });

  it("rejects missing fields", () => {
    expect(() => parseResources({} as ResourceInputs)).toThrow("CPU limit must be text");
  });

  it("bounds input length before parsing numeric values", () => {
    for (const field of Object.keys(empty) as (keyof ResourceInputs)[]) {
      expect(() => parseResources({ ...empty, [field]: "9".repeat(129) })).toThrow("must be at most 128 characters");
      expect(() => parseResources({ ...empty, [field]: `0.${"1".repeat(129)}` })).toThrow("must be at most 128 characters");
    }
    expect(parseResources({ ...empty, cpuLimit: `0.5${"0".repeat(125)}` }).cpuLimit).toBe("500000000");
  });

  it("allows reservations equal to limits or reservations without a limit", () => {
    expect(parseResources({ cpuLimit: "0.5", cpuReservation: "0.5", memoryLimit: "1 GiB", memoryReservation: "1024 MiB" })).toEqual({
      cpuLimit: "500000000", cpuReservation: "500000000", memoryLimit: "1073741824", memoryReservation: "1073741824",
    });
    expect(parseResources({ ...empty, cpuReservation: "0.25", memoryReservation: "64 MiB" })).toEqual({
      ...unset, cpuReservation: "250000000", memoryReservation: "67108864",
    });
  });

  it.each([
    [{ ...empty, cpuLimit: "0.5", cpuReservation: "1" }, "CPU reservation"],
    [{ ...empty, memoryLimit: "512 MiB", memoryReservation: "1 GiB" }, "Memory reservation"],
  ])("rejects reservations greater than the limit: %j", (input, label) => {
    expect(() => parseResources(input as ResourceInputs)).toThrow(`${label} must be less than or equal to its limit.`);
  });

  it.each(["cpuLimit", "cpuReservation"] as const)("enforces CPU bounds for %s", (field) => {
    for (const value of ["0", "0.009", "256.000000001", "99999999999999999"]) {
      expect(() => parseResources({ ...empty, [field]: value })).toThrow("between 0.01 and 256 cores");
    }
  });

  it.each(["memoryLimit", "memoryReservation"] as const)("enforces memory bounds for %s", (field) => {
    for (const value of ["0", "5 MiB", "1025 GiB", "99999999999999999 GiB"]) {
      expect(() => parseResources({ ...empty, [field]: value })).toThrow("between 6 MiB and 1024 GiB");
    }
  });

  it.each(["-1", "NaN", "Infinity", "1e2", "0.5 cores", "1 GiB", "4abc"])("rejects invalid CPU input %s", (value) => {
    expect(() => parseResources({ ...empty, cpuLimit: value })).toThrow("CPU limit must be a decimal number in cores.");
  });

  it.each(["-512 MiB", "NaN", "Infinity", "512MB", "1 GB", "512m", "1e3", "512 bytes"])("rejects ambiguous memory input %s", (value) => {
    expect(() => parseResources({ ...empty, memoryLimit: value })).toThrow("Memory limit must be a decimal number in MiB or GiB");
  });

  it("rejects fractional stored units instead of silently rounding", () => {
    expect(() => parseResources({ ...empty, cpuLimit: "0.5000000001" })).toThrow("whole nanocpu");
    expect(() => parseResources({ ...empty, memoryLimit: "6.000001 MiB" })).toThrow("whole byte");
    expect(parseResources({ ...empty, cpuLimit: "0.5000000000", memoryLimit: "512.000 MiB" })).toEqual({
      ...unset, cpuLimit: "500000000", memoryLimit: "536870912",
    });
  });
});

describe("legacy stored values", () => {
  it("does not parse oversized stored integers", () => {
    const value = "9".repeat(129);
    const input = resourceInputs({ ...unset, cpuLimit: value, memoryLimit: value });
    expect(input.cpuLimit).toBe(`Invalid stored value: ${value}`);
    expect(input.memoryLimit).toBe(`Invalid stored value: ${value}`);
  });

  it("keeps unexpectedly non-text stored values visible", () => {
    const input = resourceInputs({ ...unset, cpuLimit: 0.5, memoryLimit: 512 } as unknown as StoredResources);
    expect(input.cpuLimit).toBe("Invalid stored value: 0.5");
    expect(input.memoryLimit).toBe("Invalid stored value: 512");
  });

  it.each(["0.5", "500000000.0", "1e9", "-1", "NaN", "Infinity", "512m", "9007199254740992"])("preserves invalid stored values visibly: %s", (value) => {
    const input = resourceInputs({ ...unset, cpuLimit: value, memoryLimit: value });
    expect(input.cpuLimit).toBe(`Invalid stored value: ${value}`);
    expect(input.memoryLimit).toBe(`Invalid stored value: ${value}`);
    expect(() => parseResources(input)).toThrow("CPU limit has an invalid stored value");
    expect(() => parseResources({ ...empty, memoryLimit: input.memoryLimit })).toThrow("Memory limit has an invalid stored value");
    expect(resourcePreset(input)).toBe("Custom");
  });

  it("decodes tiny canonical integers exactly but requires correcting bounds before saving", () => {
    const input = resourceInputs({ cpuLimit: "1", cpuReservation: "0", memoryLimit: "1", memoryReservation: "0" });
    expect(input).toEqual({ cpuLimit: "0.000000001", cpuReservation: "0", memoryLimit: "0.00000095367431640625 MiB", memoryReservation: "0 MiB" });
    expect(() => parseResources(input)).toThrow("between 0.01 and 256 cores");
    expect(() => parseResources({ ...empty, memoryLimit: input.memoryLimit })).toThrow("between 6 MiB and 1024 GiB");
  });

  it("shows safe but out-of-bound stored integers exactly", () => {
    const input = resourceInputs({ ...unset, cpuLimit: "9007199254740991", memoryLimit: "9007199254740991" });
    expect(input.cpuLimit).toBe("9007199.254740991");
    expect(input.memoryLimit).toBe("8388607.999999999068677425384521484375 GiB");
    expect(() => parseResources(input)).toThrow("between 0.01 and 256 cores");
  });
});

describe("resource presets", () => {
  it.each(["Small", "Medium", "Large"] as const)("recognizes and round-trips %s", (name) => {
    expect(resourcePreset(RESOURCE_PRESETS[name])).toBe(name);
    expect(resourceInputs(parseResources(RESOURCE_PRESETS[name]))).toEqual(RESOURCE_PRESETS[name]);
  });

  it("recognizes equivalent decimal formatting and units", () => {
    expect(resourcePreset({ ...empty, cpuLimit: " 1.000 ", memoryLimit: "1024 MiB" })).toBe("Medium");
    expect(resourcePreset({ ...empty, cpuLimit: "0.500", memoryLimit: "0.5 GiB" })).toBe("Small");
  });

  it("identifies unset, edited, reserved, and invalid resources as Custom", () => {
    expect(resourcePreset(empty)).toBe("Custom");
    expect(resourcePreset({ ...RESOURCE_PRESETS.Small, cpuLimit: "0.75" })).toBe("Custom");
    expect(resourcePreset({ ...RESOURCE_PRESETS.Small, cpuReservation: "0.25" })).toBe("Custom");
    expect(resourcePreset({ ...RESOURCE_PRESETS.Small, cpuLimit: "invalid" })).toBe("Custom");
  });
});
