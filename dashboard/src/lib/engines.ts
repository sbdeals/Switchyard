import type { Engine } from "@/lib/dokploy";

export interface EngineMeta {
  id: Engine;
  label: string;
  /** Docker image base; full tag is `${image}:${version}`. */
  image: string;
  versions: string[];
  accent: string; // hex accent color for the engine
  /** Whether this engine takes a database name / user (redis takes neither). */
  hasDatabaseName: boolean;
  hasUser: boolean;
  defaultPort: number;
}

export const ENGINE_META: Record<Engine, EngineMeta> = {
  postgres: {
    id: "postgres",
    label: "PostgreSQL",
    image: "postgres",
    versions: ["18", "17", "16", "15"],
    accent: "#4f9bd9",
    hasDatabaseName: true,
    hasUser: true,
    defaultPort: 5432,
  },
  mysql: {
    id: "mysql",
    label: "MySQL",
    image: "mysql",
    versions: ["8.4", "8.0"],
    accent: "#e8a13a",
    hasDatabaseName: true,
    hasUser: true,
    defaultPort: 3306,
  },
  mariadb: {
    id: "mariadb",
    label: "MariaDB",
    image: "mariadb",
    versions: ["11", "10"],
    accent: "#c0765a",
    hasDatabaseName: true,
    hasUser: true,
    defaultPort: 3306,
  },
  mongo: {
    id: "mongo",
    label: "MongoDB",
    image: "mongo",
    versions: ["8", "7", "6"],
    accent: "#3ecf8e",
    hasDatabaseName: false,
    hasUser: true,
    defaultPort: 27017,
  },
  redis: {
    id: "redis",
    label: "Redis",
    image: "redis",
    versions: ["7", "6"],
    accent: "#ff5c5c",
    hasDatabaseName: false,
    hasUser: false,
    defaultPort: 6379,
  },
};

export const ENGINE_LIST = Object.values(ENGINE_META);

export const STATUS_META: Record<
  string,
  { label: string; color: string; soft: string; pulse?: boolean }
> = {
  done: { label: "Running", color: "var(--color-ok)", soft: "var(--color-ok-soft)" },
  running: {
    label: "Deploying",
    color: "var(--color-warn)",
    soft: "var(--color-warn-soft)",
    pulse: true,
  },
  error: { label: "Error", color: "var(--color-danger)", soft: "var(--color-danger-soft)" },
  idle: { label: "Idle", color: "var(--color-idle)", soft: "var(--color-idle-soft)" },
};
