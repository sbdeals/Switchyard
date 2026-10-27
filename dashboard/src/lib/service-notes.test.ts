import { describe, expect, it } from "vitest";
import {
  SERVICE_NOTES_MAX_LENGTH,
  capServiceNotesLength,
  normalizeServiceNotes,
  serviceNotesSubtitle,
} from "./service-notes";

describe("capServiceNotesLength", () => {
  it("keeps draft whitespace and line endings intact", () => {
    const draft = "  First line\r\nSecond line\r  ";
    expect(capServiceNotesLength(draft)).toBe(draft);
  });

  it("allows exactly 500 UTF-16 units and caps longer drafts", () => {
    const limit = "a".repeat(SERVICE_NOTES_MAX_LENGTH);
    expect(capServiceNotesLength(limit)).toBe(limit);
    expect(capServiceNotesLength(`${limit}extra`)).toBe(limit);
  });

  it("keeps an emoji that fits at the boundary", () => {
    const value = `${"a".repeat(498)}🚂`;
    expect(capServiceNotesLength(value)).toBe(value);
    expect(value.length).toBe(SERVICE_NOTES_MAX_LENGTH);
  });

  it("does not leave half an emoji at the boundary", () => {
    expect(capServiceNotesLength(`${"a".repeat(499)}🚂extra`)).toBe("a".repeat(499));
  });
});

describe("normalizeServiceNotes", () => {
  it.each(["", " ", "\n\r\t  "])("normalizes empty notes %j", (value) => {
    expect(normalizeServiceNotes(value)).toBe("");
  });

  it("trims outer whitespace while preserving internal whitespace and blank lines", () => {
    expect(normalizeServiceNotes(" \tFirst line  \n\n  Second line \t ")).toBe(
      "First line  \n\n  Second line",
    );
  });

  it("normalizes CRLF and lone CR line endings", () => {
    expect(normalizeServiceNotes("First\r\nSecond\rThird\nFourth")).toBe(
      "First\nSecond\nThird\nFourth",
    );
  });

  it("normalizes before applying the length limit", () => {
    const value = `${"a".repeat(498)}\r\nb`;
    expect(normalizeServiceNotes(`  ${value}  `)).toBe(`${"a".repeat(498)}\nb`);
  });

  it("caps long notes and removes trailing whitespace introduced by the cap", () => {
    expect(normalizeServiceNotes(`${"a".repeat(498)} \nextra`)).toBe("a".repeat(498));
    expect(normalizeServiceNotes("a".repeat(501))).toHaveLength(SERVICE_NOTES_MAX_LENGTH);
  });

  it("does not split an emoji when normalizing a long note", () => {
    expect(normalizeServiceNotes(`${"a".repeat(499)}🚂`)).toBe("a".repeat(499));
  });

  it("preserves HTML and markdown as literal text", () => {
    const value = '<script>alert("notes")</script>\n**plain text**';
    expect(normalizeServiceNotes(value)).toBe(value);
  });

  it("is stable when normalized more than once", () => {
    const value = ` \r\n${"a".repeat(498)} 🚂 \r\n `;
    const normalized = normalizeServiceNotes(value);
    expect(normalizeServiceNotes(normalized)).toBe(normalized);
  });
});

describe("serviceNotesSubtitle", () => {
  it.each([null, undefined, "", " \r\n \t"])("handles absent or empty notes %j", (value) => {
    expect(serviceNotesSubtitle(value)).toBe("");
  });

  it("returns only the trimmed first nonempty outer line", () => {
    expect(serviceNotesSubtitle(" \n First line  \r\nSecond line\rThird ")).toBe("First line");
  });

  it("keeps literal HTML as text", () => {
    expect(serviceNotesSubtitle("<script>alert(1)</script>\nDetails")).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("does not cap descriptions already stored in Dokploy", () => {
    const firstLine = "a".repeat(600);
    expect(serviceNotesSubtitle(`${firstLine}\nDetails`)).toBe(firstLine);
  });
});
