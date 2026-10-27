import type { Service } from "@/lib/dokploy";
import type { PortWarning } from "@/lib/port-conflicts";

export interface PortConflictProps {
  services: Service[];
  onSelectService: (id: string) => void;
}

export function PortConflictWarning({
  warnings,
  onSelectService,
}: {
  warnings: PortWarning[];
  onSelectService: (id: string) => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <div role="status" className="space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
      {warnings.map(({ port, protocol, conflicts, reserved }) => (
        <p key={`${port}/${protocol}`}>
          <span className="font-mono">{port}/{protocol}</span>{" "}
          {reserved && "is reserved on this host for the dashboard/Dokploy. "}
          {conflicts.length > 0 && (
            <>
              {reserved ? "Also published by " : "is already published by "}
              {conflicts.map((service, index) => (
                <span key={service.serviceId}>
                  {index > 0 && ", "}
                  <a
                    href={`#service-${encodeURIComponent(service.serviceId)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      onSelectService(service.serviceId);
                    }}
                    className="font-medium underline underline-offset-2 hover:text-amber-100"
                  >
                    {service.serviceName}
                  </a>
                </span>
              ))}.
            </>
          )}
        </p>
      ))}
      <p>
        {warnings.some((warning) => warning.conflicts.length > 0) && "The other service may be stopped. "}
        Choose Save anyway to keep this port despite the possible conflict.
      </p>
    </div>
  );
}
