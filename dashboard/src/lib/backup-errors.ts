type BackupErrorInput = {
  accessKey?: unknown;
  secretAccessKey?: unknown;
  sessionToken?: unknown;
  endpoint?: unknown;
};

/** Shared by the destination form and the server's destination mutations. */
export function validateS3Endpoint(endpoint: unknown): string | null {
  if (typeof endpoint === "string" && /^https?:\/\/[^/\\]/i.test(endpoint) && !/[\s\\]/.test(endpoint)) {
    try {
      const url = new URL(endpoint);
      if (url.hostname && !url.username && !url.password) return null;
    } catch {
      // Fall through to the same guidance for malformed and non-HTTP URLs.
    }
  }
  return "Enter a full HTTP(S) endpoint URL without credentials, like https://s3.us-east-1.amazonaws.com.";
}

/** Sanitize BEFORE truncating or throwing: rclone errors echo command arguments. */
export function formatBackupError(error: unknown, input: BackupErrorInput = {}): string {
  const message = error instanceof Error ? error.message : String(error);
  // Also cover literals escaped inside JSON responses / tRPC log events. Use a
  // longest-first literal match so overlapping credentials stay hidden.
  const secrets = [input.accessKey, input.secretAccessKey, input.sessionToken]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((value) => [value, JSON.stringify(value).slice(1, -1)])
    .sort((a, b) => b.length - a.length);
  const literalPattern = secrets.length
    ? new RegExp(secrets.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g")
    : null;
  const redact = (text: string) => {
    const ranges: [number, number][] = [];
    if (literalPattern) {
      for (const match of text.matchAll(literalPattern)) {
        ranges.push([match.index, match.index + match[0].length]);
      }
    }
    const flags = /(--[a-z0-9-]*(?:secret|password|token|key)[a-z0-9-]*(?:[ \t]*=[ \t]*|[ \t]+))(?:\\"(?:[^\\]|\\(?!"))*\\"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/gi;
    for (const match of text.matchAll(flags)) {
      ranges.push([match.index + match[1].length, match.index + match[0].length]);
    }
    for (const match of text.matchAll(/([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi)) {
      ranges.push([match.index + match[1].length, match.index + match[0].length - 1]);
    }
    // Merge overlapping matches before replacing, so masking a flag cannot
    // leave a fragment of a submitted credential containing spaces behind.
    let safe = "";
    let end = 0;
    for (const [start, stop] of ranges.sort((a, b) => a[0] - b[0])) {
      if (start >= end) safe += text.slice(end, start) + "********";
      end = Math.max(end, stop);
    }
    return safe + text.slice(end);
  };

  const endpoint = typeof input.endpoint === "string"
    ? input.endpoint
    : message.match(/--s3-endpoint(?:=|\s+)(?:"([^"]*)"|'([^']*)'|(\S+))/i)?.slice(1).find(Boolean);
  let summary = "The S3 backup request failed. Check the details below.";
  if ((endpoint && validateS3Endpoint(endpoint)) || /invalid (?:s3 )?endpoint|unsupported protocol scheme|missing protocol scheme/i.test(message)) {
    summary = `Couldn't reach ${endpoint ? `the endpoint '${endpoint}'` : "the endpoint"}. Use a full URL like https://s3.us-east-1.amazonaws.com.`;
  } else if (/no such host|ENOTFOUND|ENETUNREACH|connection refused|ECONNREFUSED|i\/o timeout|ETIMEDOUT/i.test(message)) {
    summary = "Couldn't reach the S3 endpoint. Check the endpoint URL and network connection.";
  } else if (/NoSuchBucket/i.test(message)) {
    summary = "The S3 bucket wasn't found. Check the bucket name and region.";
  } else if (/SignatureDoesNotMatch/i.test(message)) {
    summary = "S3 couldn't verify the request signature. Check the access key, secret key, and region.";
  } else if (/AccessDenied|InvalidAccessKeyId/i.test(message)) {
    summary = "S3 denied access. Check the credentials and bucket permissions.";
  }
  return `${redact(summary)}\n\n${redact(message).slice(0, 2000)}`;
}
