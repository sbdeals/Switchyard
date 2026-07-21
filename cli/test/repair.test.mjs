import assert from "node:assert/strict";
import test from "node:test";

import { collectComposeIds, needsRepair, parseContainerRows } from "../dist/lib.js";

test("collectComposeIds finds ids at any nesting depth and dedupes", () => {
  const tree = [
    {
      name: "p1",
      environments: [
        { compose: [{ composeId: "aaa" }, { composeId: "bbb", extra: { composeId: "aaa" } }] },
      ],
    },
    { compose: [{ composeId: "ccc" }] },
    "noise",
    null,
    42,
  ];
  assert.deepEqual(collectComposeIds(tree).sort(), ["aaa", "bbb", "ccc"]);
});

test("collectComposeIds tolerates non-object roots", () => {
  assert.deepEqual(collectComposeIds(null), []);
  assert.deepEqual(collectComposeIds("x"), []);
  assert.deepEqual(collectComposeIds({ composeId: "" }), []);
});

test("needsRepair leaves a running stack alone, one-shot exits included", () => {
  assert.equal(
    needsRepair([
      { id: "a", state: "running" },
      { id: "b", state: "exited" },
    ]),
    false,
  );
});

test("needsRepair fires on the wedged-created pile even beside a running sibling", () => {
  // The observed VM-reset signature: one survivor running, the rest stuck in
  // "created" behind a crash-looping config reader.
  assert.equal(
    needsRepair([
      { id: "a", state: "running" },
      { id: "b", state: "created" },
    ]),
    true,
  );
});

test("needsRepair fires when nothing is running", () => {
  assert.equal(needsRepair([]), true);
  assert.equal(needsRepair([{ id: "a", state: "exited" }]), true);
  assert.equal(needsRepair([{ id: "a", state: "restarting" }]), true);
});

test("parseContainerRows parses the ID/State format and drops blank lines", () => {
  const rows = parseContainerRows("abc\trunning\n\n  def\tcreated\n\tcreated\n");
  assert.deepEqual(rows, [
    { id: "abc", state: "running" },
    { id: "def", state: "created" },
  ]);
});
