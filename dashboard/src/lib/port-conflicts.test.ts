import { describe, expect, it } from "vitest";
import type { Service } from "./dokploy";
import {
  collectPublishedPorts,
  findPortConflicts,
  getPortWarnings,
  isReservedHostPort,
  isValidPort,
  parseComposePorts,
} from "./port-conflicts";

const services = [
  {
    id: "app-one", name: "API", kind: "application", status: "idle",
    ports: [
      { publishedPort: 3072, targetPort: 80, protocol: "tcp" },
      { publishedPort: 3072, targetPort: 81, protocol: "tcp" },
      { publishedPort: 3073, targetPort: 53, protocol: "udp" },
      { publishedPort: 0, targetPort: 80, protocol: "tcp" },
    ],
  },
  { id: "db-one", name: "Postgres", kind: "database", externalPort: 5432 },
  { id: "db-private", name: "Private database", kind: "database", externalPort: null },
  {
    id: "stack-one", name: "Worker stack", kind: "compose",
    composeFile: 'services:\n  worker:\n    ports:\n      - "3072:80"\n      - "3074:53/udp"\n',
  },
] as Service[];

describe("published port validation", () => {
  it.each([1, 80, 3072, 65535])("accepts port %s", (port) => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([0, -1, 65536, 1.5, NaN, Infinity])("rejects port %s", (port) => {
    expect(isValidPort(port)).toBe(false);
  });

  it("flags only the host's known dashboard and proxy ports", () => {
    expect([80, 443, 3000, 3001].every(isReservedHostPort)).toBe(true);
    expect([0, 53, 3072, 5432, 65535].some(isReservedHostPort)).toBe(false);
  });
});

describe("collectPublishedPorts", () => {
  it("collects applications, external database ports and compose ports, including stopped services", () => {
    expect(collectPublishedPorts(services)).toEqual([
      { port: 3072, protocol: "tcp", serviceId: "app-one", serviceName: "API" },
      { port: 3072, protocol: "tcp", serviceId: "app-one", serviceName: "API" },
      { port: 3073, protocol: "udp", serviceId: "app-one", serviceName: "API" },
      { port: 5432, protocol: "tcp", serviceId: "db-one", serviceName: "Postgres" },
      { port: 3072, protocol: "tcp", serviceId: "stack-one", serviceName: "Worker stack" },
      { port: 3074, protocol: "udp", serviceId: "stack-one", serviceName: "Worker stack" },
    ]);
  });

  it("ignores invalid database and application ports", () => {
    expect(collectPublishedPorts([
      { id: "db", name: "DB", kind: "database", externalPort: 65536 },
      { id: "app", name: "App", kind: "application", ports: [{ publishedPort: 42.5, protocol: "tcp" }] },
    ] as Service[])).toEqual([]);
    expect(collectPublishedPorts([])).toEqual([]);
  });
});

describe("findPortConflicts", () => {
  const published = collectPublishedPorts(services);

  it("names each conflicting service once", () => {
    expect(findPortConflicts(published, "app-two", { port: 3072, protocol: "tcp" })).toEqual([
      { serviceId: "app-one", serviceName: "API" },
      { serviceId: "stack-one", serviceName: "Worker stack" },
    ]);
  });

  it("excludes the service being edited", () => {
    expect(findPortConflicts(published, "app-one", { port: 3072, protocol: "tcp" })).toEqual([
      { serviceId: "stack-one", serviceName: "Worker stack" },
    ]);
    expect(findPortConflicts(published, "db-one", { port: 5432, protocol: "tcp" })).toEqual([]);
  });

  it("keeps TCP and UDP separate", () => {
    expect(findPortConflicts(published, "app-two", { port: 3072, protocol: "udp" })).toEqual([]);
    expect(findPortConflicts(published, "app-two", { port: 3073, protocol: "tcp" })).toEqual([]);
    expect(findPortConflicts(published, "app-two", { port: 3073, protocol: "udp" })).toEqual([
      { serviceId: "app-one", serviceName: "API" },
    ]);
  });

  it("returns no conflicts for unused or invalid ports", () => {
    expect(findPortConflicts(published, "app-two", { port: 3075, protocol: "tcp" })).toEqual([]);
    expect(findPortConflicts(published, "app-two", { port: 0, protocol: "tcp" })).toEqual([]);
  });
});

describe("getPortWarnings", () => {
  it("deduplicates proposed ports and includes service and reserved warnings", () => {
    expect(getPortWarnings(services, "app-two", [
      { port: 3072, protocol: "tcp" },
      { port: 3072, protocol: "tcp" },
      { port: 443, protocol: "tcp" },
      { port: 443, protocol: "udp" },
      { port: 0, protocol: "tcp" },
    ])).toEqual([
      {
        port: 3072, protocol: "tcp", reserved: false,
        conflicts: [
          { serviceId: "app-one", serviceName: "API" },
          { serviceId: "stack-one", serviceName: "Worker stack" },
        ],
      },
      { port: 443, protocol: "tcp", reserved: true, conflicts: [] },
      { port: 443, protocol: "udp", reserved: true, conflicts: [] },
    ]);
  });

  it("clears warnings when a conflicting or reserved proposal changes to an unused port", () => {
    expect(getPortWarnings(services, "app-two", [{ port: 3072, protocol: "tcp" }])).toHaveLength(1);
    expect(getPortWarnings(services, "app-two", [{ port: 3001, protocol: "tcp" }])).toHaveLength(1);
    expect(getPortWarnings(services, "app-two", [{ port: 3075, protocol: "tcp" }])).toEqual([]);
    expect(getPortWarnings(services, "app-two", [])).toEqual([]);
  });

  it("reports both reasons when another service publishes a reserved port", () => {
    const reserved = [{ id: "db", name: "DB", kind: "database", externalPort: 3000 }] as Service[];
    expect(getPortWarnings(reserved, "app", [{ port: 3000, protocol: "tcp" }])).toEqual([
      { port: 3000, protocol: "tcp", reserved: true, conflicts: [{ serviceId: "db", serviceName: "DB" }] },
    ]);
  });

  it("handles large Compose ranges without checking every proposal against every published port", () => {
    const composeFile = 'services:\n  web:\n    ports:\n      - "1-8000:1-8000"\n';
    const range = { id: "range", name: "Range", kind: "compose", composeFile } as Service;
    expect(getPortWarnings([range], range.id, parseComposePorts(composeFile))).toEqual(
      [80, 443, 3000, 3001].map((port) => ({ port, protocol: "tcp", conflicts: [], reserved: true })),
    );
  });
});

describe("parseComposePorts", () => {
  it("reads short syntax, host IPs, quoted values, comments and protocols", () => {
    expect(parseComposePorts(`services:
  web:
    ports:
      - "8080:80" # web
      - '127.0.0.1:8081:81'
      - "[::1]:8082:82/udp"
      - 8083:83/tcp
  dns:
    ports:
      - "5353:53/udp"
`)).toEqual([
      { port: 8080, protocol: "tcp" },
      { port: 8081, protocol: "tcp" },
      { port: 8082, protocol: "udp" },
      { port: 8083, protocol: "tcp" },
      { port: 5353, protocol: "udp" },
    ]);
  });

  it("reads long syntax with a default TCP protocol and either field order", () => {
    expect(parseComposePorts(`services:
  web:
    ports:
      - target: 80
        published: "8080"
        host_ip: 127.0.0.1
        mode: host
      - published: 5353
        target: 53
        protocol: udp
      -
        target: 90
        published: 8090
`)).toEqual([
      { port: 8080, protocol: "tcp" }, { port: 5353, protocol: "udp" }, { port: 8090, protocol: "tcp" },
    ]);
  });

  it("reads inline lists and long flow entries", () => {
    expect(parseComposePorts(`services:
  web:
    ports: ["8080:80", '127.0.0.1:5353:53/udp', {target: 90, published: "8090", protocol: tcp}]
  other:
    ports:
      - {target: 91, published: 8091, protocol: udp}
`)).toEqual([
      { port: 8080, protocol: "tcp" }, { port: 5353, protocol: "udp" },
      { port: 8090, protocol: "tcp" }, { port: 8091, protocol: "udp" },
    ]);
  });

  it("reads indented and indentless port lists", () => {
    expect(parseComposePorts('services:\n  web:\n    ports:\n    - "8080:80"\n    - "8081:81"\n    image: nginx\n'))
      .toEqual([{ port: 8080, protocol: "tcp" }, { port: 8081, protocol: "tcp" }]);
  });

  it("expands valid short and long published ranges", () => {
    expect(parseComposePorts(`services:
  web:
    ports:
      - "8080-8082:80-82/udp"
      - target: 90
        published: "8090-8091"
`)).toEqual([
      { port: 8080, protocol: "udp" }, { port: 8081, protocol: "udp" }, { port: 8082, protocol: "udp" },
      { port: 8090, protocol: "tcp" }, { port: 8091, protocol: "tcp" },
    ]);
  });

  it("ignores interpolated entries including env-based IPs, protocols and targets", () => {
    expect(parseComposePorts(`services:
  web:
    ports:
      - "\${PORT}:80"
      - "\${PORT:-8080}:80"
      - "8081:$TARGET"
      - "8082:80/\${PROTOCOL}"
      - target: 80
        published: 8083
        host_ip: \${BIND_ADDRESS}
      - target: 80
        published: \${PORT}
      - "8084:80"
`)).toEqual([{ port: 8084, protocol: "tcp" }]);
  });

  it("ignores target-only, invalid, reversed and mismatched port ranges", () => {
    const entries = [
      '"80"', "80", '"80-82"', '"0:80"', '"65536:80"', '"8080:0"', '"8080:65536"',
      '"8080:80/sctp"', '"8080.5:80"', '"8082-8080:80-82"', '"8080-8082:80-81"',
      '"65534-65536:80-82"', '"nonsense"', '{target: 80}', '{published: 8080}',
      '{target: 80, published: 8080, protocol: sctp}', '{target: 0, published: 8080}',
      '{target: 80, published: 0}', '{target: 80, published: 8080, published: 8081}',
    ];
    for (const entry of entries) {
      expect(parseComposePorts(`services:\n  web:\n    ports:\n      - ${entry}\n`), entry).toEqual([]);
    }
  });

  it("only reads service ports, ignoring expose, labels, extensions and literal scripts", () => {
    expect(parseComposePorts(`x-example:
  ports: ["8000:80"]
services:
  web:
    expose: ["8001:80"]
    labels:
      ports: ["8002:80"]
    command: |
      ports:
        - "8003:80"
    ports: ["8080:80"]
volumes:
  data:
    ports: ["8004:80"]
`)).toEqual([{ port: 8080, protocol: "tcp" }]);
  });

  it("tolerates missing and unsupported YAML without inventing published ports", () => {
    for (const file of [null, "", "nonsense", "services: {}", "services:\n  web:\n    ports: *shared", "services:\n  web:\n    ports: [\"8080:80\", {"]) {
      expect(parseComposePorts(file)).toEqual([]);
    }
  });

  it("does not read nested fields as a long port mapping", () => {
    expect(parseComposePorts(`services:
  web:
    ports:
      - target: 80
        metadata:
          published: 8080
      - target: 81
        published: 8081
          protocol: udp
`)).toEqual([]);
  });
});
