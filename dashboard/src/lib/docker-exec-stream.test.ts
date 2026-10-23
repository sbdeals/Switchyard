import { describe, expect, it } from "vitest";
import { dockerExecOutput } from "./docker-exec-stream";

function header(stream: number, size: number): Buffer {
  const result = Buffer.alloc(8);
  result[0] = stream;
  result.writeUInt32BE(size, 4);
  return result;
}

function frame(stream: number, payload: Buffer): Buffer {
  return Buffer.concat([header(stream, payload.length), payload]);
}

async function* chunks(parts: Buffer[]): AsyncGenerator<Buffer> {
  yield* parts;
}

async function collect(source: AsyncIterable<Buffer>, stderr: (chunk: Buffer) => void = () => {}): Promise<Buffer> {
  const output: Buffer[] = [];
  for await (const chunk of dockerExecOutput(source, stderr)) output.push(chunk);
  return Buffer.concat(output);
}

describe("dockerExecOutput", () => {
  it("preserves binary output when headers and payloads arrive one byte at a time", async () => {
    const binary = Buffer.from([0, 255, 128, 13, 10, 0, 195, 40]);
    const wire = Buffer.concat([frame(1, binary), frame(1, Buffer.from("PGDMP"))]);
    const source = chunks(Array.from(wire, (byte) => Buffer.from([byte])));
    expect(await collect(source)).toEqual(Buffer.concat([binary, Buffer.from("PGDMP")]));
  });

  it("keeps stderr out of the backup across adjacent and fragmented frames", async () => {
    const errors: Buffer[] = [];
    const wire = Buffer.concat([
      frame(2, Buffer.from("warning: ")),
      frame(1, Buffer.from([0, 1, 2, 255])),
      frame(2, Buffer.from("partial dump\n")),
      frame(1, Buffer.from([128, 0])),
    ]);
    const parts = [wire.subarray(0, 11), wire.subarray(11, 28), wire.subarray(28)];
    expect(await collect(chunks(parts), (chunk) => errors.push(chunk))).toEqual(Buffer.from([0, 1, 2, 255, 128, 0]));
    expect(Buffer.concat(errors).toString()).toBe("warning: partial dump\n");
  });

  it("yields part of a frame immediately and waits for demand before reading more", async () => {
    let pulls = 0;
    let closed = false;
    const first = Buffer.from([0, 255]);
    const remainder = Buffer.alloc(4094, 128);
    async function* source() {
      try {
        pulls++;
        yield Buffer.concat([header(1, first.length + remainder.length), first]);
        pulls++;
        yield remainder;
      } finally {
        closed = true;
      }
    }
    const output = dockerExecOutput(source(), () => {});
    expect(await output.next()).toEqual({ value: first, done: false });
    expect(pulls).toBe(1);
    // A full-frame buffer or eager source consumer would already have pulled
    // the second chunk before the downstream writer requested it.
    expect(closed).toBe(false);
    expect(await output.next()).toEqual({ value: remainder, done: false });
    expect(pulls).toBe(2);
    expect(await output.next()).toEqual({ value: undefined, done: true });
    expect(closed).toBe(true);
  });

  it("closes the upstream iterator when the backup writer stops consuming", async () => {
    let closed = false;
    async function* source() {
      try {
        yield frame(1, Buffer.from("first"));
        throw new Error("must not read ahead");
      } finally {
        closed = true;
      }
    }
    const output = dockerExecOutput(source(), () => {});
    expect((await output.next()).value).toEqual(Buffer.from("first"));
    await output.return(undefined);
    expect(closed).toBe(true);
  });

  it.each([0, 3, 255])("rejects invalid stream number %i", async (stream) => {
    await expect(collect(chunks([frame(stream, Buffer.from("payload"))]))).rejects.toThrow("Invalid Docker exec stream");
  });

  it.each([1, 2, 3])("rejects a nonzero reserved header byte at offset %i", async (offset) => {
    const invalid = header(1, 0);
    invalid[offset] = 1;
    await expect(collect(chunks([invalid]))).rejects.toThrow("Invalid Docker exec stream");
  });

  it.each([
    Buffer.from([1]),
    header(1, 0).subarray(0, 7),
    header(1, 1),
    Buffer.concat([header(1, 5), Buffer.from("four")]),
    Buffer.concat([header(2, 5), Buffer.from("four")]),
    Buffer.concat([header(1, 0xffffffff), Buffer.from([0])]),
  ])("rejects an incomplete header or payload (%j)", async (wire) => {
    await expect(collect(chunks([wire]))).rejects.toThrow("ended before the backup finished");
  });

  it("handles empty sources, chunks, and stdout/stderr frames without emitting payload", async () => {
    const errors: Buffer[] = [];
    expect(await collect(chunks([]))).toEqual(Buffer.alloc(0));
    const wire = Buffer.concat([
      header(1, 0), header(2, 0), frame(1, Buffer.from("dump")), header(1, 0), header(2, 0),
    ]);
    expect(await collect(chunks([Buffer.alloc(0), wire, Buffer.alloc(0)]), (chunk) => errors.push(chunk)))
      .toEqual(Buffer.from("dump"));
    expect(errors).toEqual([]);
  });

  it("propagates source failures instead of accepting a partial backup", async () => {
    async function* source() {
      yield frame(1, Buffer.from("partial"));
      throw new Error("socket disconnected");
    }
    await expect(collect(source())).rejects.toThrow("socket disconnected");
  });
});
