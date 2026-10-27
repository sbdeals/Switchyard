export interface StoredResources {
  cpuLimit: string | null;
  cpuReservation: string | null;
  memoryLimit: string | null;
  memoryReservation: string | null;
}

export type ResourceInputs = { [K in keyof StoredResources]: string };

const ZERO = BigInt(0);
const TEN = BigInt(10);
const NANOS = BigInt(1_000_000_000);
const MIB = BigInt(1_048_576);
const GIB = BigInt(1_073_741_824);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INVALID_STORED = "Invalid stored value: ";
const MAX_INPUT_LENGTH = 128;

const LABELS: Record<keyof StoredResources, string> = {
  cpuLimit: "CPU limit",
  cpuReservation: "CPU reservation",
  memoryLimit: "Memory limit",
  memoryReservation: "Memory reservation",
};

/** Presets set limits and leave reservations unset. */
export const RESOURCE_PRESETS = {
  Small: { cpuLimit: "0.5", cpuReservation: "", memoryLimit: "512 MiB", memoryReservation: "" },
  Medium: { cpuLimit: "1", cpuReservation: "", memoryLimit: "1 GiB", memoryReservation: "" },
  Large: { cpuLimit: "2", cpuReservation: "", memoryLimit: "2 GiB", memoryReservation: "" },
} satisfies Record<string, ResourceInputs>;

/** Format exactly: both scales have terminating decimal expansions. */
function decimal(value: bigint, scale: bigint): string {
  const whole = value / scale;
  let remainder = value % scale;
  if (remainder === ZERO) return String(whole);
  let fraction = "";
  while (remainder !== ZERO) {
    remainder *= TEN;
    fraction += String(remainder / scale);
    remainder %= scale;
  }
  return `${whole}.${fraction}`;
}

function storedInput(value: string | null, cpu: boolean): string {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > MAX_INPUT_LENGTH) return `${INVALID_STORED}${value}`;
  const raw = value.trim();
  if (raw === "") return "";
  // Dokploy stores integer nanocpus/bytes. Never guess that a legacy decimal
  // CPU value means cores or that a memory suffix denotes bytes.
  if (!/^\d+$/.test(raw) || BigInt(raw) > MAX_SAFE) return `${INVALID_STORED}${value}`;
  const stored = BigInt(raw);
  if (cpu) return decimal(stored, NANOS);
  const scale = stored >= GIB ? GIB : MIB;
  return `${decimal(stored, scale)} ${scale === GIB ? "GiB" : "MiB"}`;
}

/** Decode even out-of-bounds legacy integers exactly; explicit saves validate them. */
export function resourceInputs(stored: StoredResources): ResourceInputs {
  return {
    cpuLimit: storedInput(stored.cpuLimit, true),
    cpuReservation: storedInput(stored.cpuReservation, true),
    memoryLimit: storedInput(stored.memoryLimit, false),
    memoryReservation: storedInput(stored.memoryReservation, false),
  };
}

function parseValue(input: string, field: keyof StoredResources): string | null {
  const label = LABELS[field];
  if (typeof input !== "string") throw new Error(`${label} must be text; leave it empty to unset it.`);
  if (input.length > MAX_INPUT_LENGTH) throw new Error(`${label} must be at most ${MAX_INPUT_LENGTH} characters.`);
  const raw = input.trim();
  if (!raw) return null;
  if (raw.startsWith(INVALID_STORED)) {
    throw new Error(`${label} has an invalid stored value. Enter a new value or clear it.`);
  }
  const cpu = field.startsWith("cpu");
  const match = raw.match(/^(\d+(?:\.\d*)?|\.\d+)\s*(MiB|GiB)?$/i);
  if (!match || (cpu && match[2])) {
    throw new Error(`${label} must be a decimal number ${cpu ? "in cores" : "in MiB or GiB (bare numbers mean MiB)"}.`);
  }
  const [whole, fraction = ""] = match[1].split(".");
  const scale = cpu ? NANOS : match[2]?.toLowerCase() === "gib" ? GIB : MIB;
  const denominator = BigInt(`1${"0".repeat(fraction.length)}`);
  const numerator = BigInt(`${whole || "0"}${fraction}`) * scale;
  if (numerator % denominator !== ZERO) {
    throw new Error(`${label} must resolve to a whole ${cpu ? "nanocpu" : "byte"}. Use fewer decimal places.`);
  }
  const stored = numerator / denominator;
  const min = cpu ? BigInt(10_000_000) : BigInt(6) * MIB;
  const max = cpu ? BigInt(256) * NANOS : BigInt(1024) * GIB;
  if (stored < min || stored > max || stored > MAX_SAFE) {
    throw new Error(`${label} must be between ${cpu ? "0.01 and 256 cores" : "6 MiB and 1024 GiB"}, or left empty.`);
  }
  return String(stored);
}

/** Human units -> Dokploy v0.30.10 integer nanocpus/bytes, without rounding. */
export function parseResources(input: ResourceInputs): StoredResources {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Resources must be an object with CPU and memory fields.");
  }
  const stored: StoredResources = {
    cpuLimit: parseValue(input.cpuLimit, "cpuLimit"),
    cpuReservation: parseValue(input.cpuReservation, "cpuReservation"),
    memoryLimit: parseValue(input.memoryLimit, "memoryLimit"),
    memoryReservation: parseValue(input.memoryReservation, "memoryReservation"),
  };
  for (const kind of ["cpu", "memory"] as const) {
    const limit = stored[`${kind}Limit`];
    const reservation = stored[`${kind}Reservation`];
    if (limit !== null && reservation !== null && BigInt(reservation) > BigInt(limit)) {
      throw new Error(`${LABELS[`${kind}Reservation`]} must be less than or equal to its limit.`);
    }
  }
  return stored;
}

export function resourcePreset(input: ResourceInputs): keyof typeof RESOURCE_PRESETS | "Custom" {
  try {
    const stored = parseResources(input);
    for (const name of Object.keys(RESOURCE_PRESETS) as (keyof typeof RESOURCE_PRESETS)[]) {
      const preset = parseResources(RESOURCE_PRESETS[name]);
      if ((Object.keys(stored) as (keyof StoredResources)[]).every((key) => stored[key] === preset[key])) return name;
    }
  } catch {
    // Invalid or legacy values must remain visible as Custom until corrected.
  }
  return "Custom";
}
