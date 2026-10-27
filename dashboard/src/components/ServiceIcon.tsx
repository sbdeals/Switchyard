"use client";

import { useState } from "react";
import { Box, ContactRound, Database, Layers, Network } from "lucide-react";
import type { ServiceIconKind } from "@/lib/service-icon";

const ICON_META: Record<ServiceIconKind, { label: string; color?: string; badge?: string }> = {
  postgres: { label: "PostgreSQL", color: "#7db8e8", badge: "PG" },
  mysql: { label: "MySQL", color: "#f4bb62", badge: "My" },
  mariadb: { label: "MariaDB", color: "#e9a68b", badge: "Ma" },
  mongo: { label: "MongoDB", color: "#62d99b" },
  redis: { label: "Redis", color: "#ff8585" },
  nginx: { label: "NGINX", color: "#62d99b", badge: "N" },
  node: { label: "Node.js", color: "#8ed47d", badge: "JS" },
  python: { label: "Python", color: "#f4d36b", badge: "Py" },
  traefik: { label: "Traefik", color: "#79d6e5" },
  whoami: { label: "whoami", color: "#79d6e5" },
  github: { label: "GitHub", color: "#ededf2" },
  compose: { label: "Compose stack" },
  database: { label: "Database" },
  application: { label: "Application" },
};

/** Catalog logos take precedence; missing or broken images use a local badge. */
export function ServiceIcon({
  icon,
  logo,
  logoLabel,
  accent,
  size = "size-9",
  rounded = "rounded-lg",
}: {
  icon: ServiceIconKind;
  logo?: string | null;
  logoLabel?: string;
  accent: string;
  size?: string;
  rounded?: string;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const { label, color = accent, badge } = ICON_META[icon];
  const Glyph = icon === "compose" ? Layers
    : icon === "database" ? Database
    : icon === "traefik" ? Network
    : icon === "whoami" ? ContactRound
    : Box;
  const custom = badge || icon === "mongo" || icon === "redis" || icon === "github";

  return (
    <div
      className={`flex ${size} shrink-0 items-center justify-center overflow-hidden ${rounded}`}
      style={{ backgroundColor: `${accent}1a`, color }}
    >
      {logo && logo !== failedLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- Dokploy catalog logos use arbitrary hosts
        <img
          src={logo}
          alt={`${logoLabel ?? label} logo`}
          title={`${logoLabel ?? label} logo`}
          className="size-[70%] object-contain"
          onError={() => setFailedLogo(logo)}
        />
      ) : custom ? (
        <svg viewBox="0 0 24 24" className="size-[70%]" role="img" aria-label={label}>
          <title>{label}</title>
          {badge ? (
            <>
              {icon === "nginx" || icon === "node" ? (
                <path d="M12 1.5 21 6.75v10.5L12 22.5 3 17.25V6.75Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
              ) : null}
              <text
                x="12"
                y="16.5"
                textAnchor="middle"
                fill="currentColor"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontSize={icon === "node" ? 11 : 14}
                fontWeight="700"
              >
                {badge}
              </text>
            </>
          ) : icon === "mongo" ? (
            <>
              <path d="M12 2C10 5 5 8 6 13c.5 4 4 6 6 7 2-1 5.5-3 6-7 1-5-4-8-6-11Z" fill="currentColor" />
              <path d="M12 7v15" fill="none" stroke="var(--color-surface)" strokeWidth="1.5" />
            </>
          ) : icon === "redis" ? (
            <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
              <path d="m2 15 10 5 10-5M2 11l10 5 10-5" />
              <path d="m2 7 10-4 10 4-10 5Z" />
            </g>
          ) : (
            <path fill="currentColor" d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.23 1.84 1.23 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.66.24 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.81 1.1.81 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
          )}
        </svg>
      ) : (
        <Glyph className="size-[50%]" role="img" aria-label={label}>
          <title>{label}</title>
        </Glyph>
      )}
    </div>
  );
}
