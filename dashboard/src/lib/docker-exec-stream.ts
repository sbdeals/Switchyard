/** Binary-safe Docker exec demultiplexing with backpressure and bounded memory. */
export async function* dockerExecOutput(
  source: AsyncIterable<Buffer>,
  stderr: (chunk: Buffer) => void,
): AsyncGenerator<Buffer> {
  const header = Buffer.alloc(8);
  let headerBytes = 0;
  let remaining = 0;
  let stream = 0;
  for await (const chunk of source) {
    let offset = 0;
    while (offset < chunk.length) {
      if (remaining === 0) {
        const count = Math.min(8 - headerBytes, chunk.length - offset);
        chunk.copy(header, headerBytes, offset, offset + count);
        headerBytes += count;
        offset += count;
        if (headerBytes < 8) continue;
        stream = header[0];
        if ((stream !== 1 && stream !== 2) || header[1] || header[2] || header[3]) {
          throw new Error("Invalid Docker exec stream.");
        }
        remaining = header.readUInt32BE(4);
        headerBytes = 0;
      }
      const count = Math.min(remaining, chunk.length - offset);
      const payload = chunk.subarray(offset, offset + count);
      if (stream === 1 && count) yield payload;
      else if (stream === 2 && count) stderr(payload);
      offset += count;
      remaining -= count;
    }
  }
  if (remaining || headerBytes) throw new Error("Docker exec stream ended before the backup finished.");
}
