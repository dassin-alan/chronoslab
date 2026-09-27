import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeInterval,
  normalizeDuration,
  normalizeOperators,
  normalizeDependsOn,
  normalizePriority,
  normalizeInput
} from "../src/normalize.js";

test("normalizeInterval: string form 08:00-18:00", () => {
  const r = normalizeInterval("08:00-18:00");
  assert.equal(r.ok, true);
  assert.deepEqual(r.interval, { start: 480, end: 1080 });
});

test("normalizeInterval: array form [start, end]", () => {
  const r = normalizeInterval(["09:00", "17:00"]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.interval, { start: 540, end: 1020 });
});

test("normalizeInterval: object form {start,end}", () => {
  const r = normalizeInterval({ start: "10:00", end: "18:00" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.interval, { start: 600, end: 1080 });
});

test("normalizeDuration: six formats", () => {
  assert.equal(normalizeDuration(90).duration, 90);
  assert.equal(normalizeDuration("90").duration, 90);
  assert.equal(normalizeDuration("90min").duration, 90);
  assert.equal(normalizeDuration("60 min").duration, 60);
  assert.equal(normalizeDuration("01:30").duration, 90);
  assert.equal(normalizeDuration("0:45").duration, 45);
});

test("normalizeDuration: rejects non-15 multiples", () => {
  const r = normalizeDuration(20);
  assert.equal(r.ok, false);
});

test("normalizeOperators: string to array", () => {
  assert.deepEqual(normalizeOperators("Lin"), ["Lin"]);
  assert.deepEqual(normalizeOperators(["Chen", "Zhao"]), ["Chen", "Zhao"]);
});

test("normalizeDependsOn: null empty string string array", () => {
  assert.deepEqual(normalizeDependsOn(null), []);
  assert.deepEqual(normalizeDependsOn(""), []);
  assert.deepEqual(normalizeDependsOn("T01"), ["T01"]);
  assert.deepEqual(normalizeDependsOn(["T01", "T02"]), ["T01", "T02"]);
});

test("normalizePriority: HIGH MEDIUM LOW and numbers", () => {
  assert.equal(normalizePriority("HIGH").priority, 9);
  assert.equal(normalizePriority("MEDIUM").priority, 5);
  assert.equal(normalizePriority("LOW").priority, 2);
  assert.equal(normalizePriority(7).priority, 7);
  assert.equal(normalizePriority("6").priority, 6);
  assert.equal(normalizePriority(15).priority, 10);
  assert.equal(normalizePriority(0).priority, 1);
});

test("normalizeInput: trims names", () => {
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: " 设备A ",
        available: "08:00-18:00",
        maintenance: []
      }
    ],
    [
      {
        id: "Op1",
        name: " 操作员 ",
        available: "08:00-18:00"
      }
    ],
    [
      {
        id: "T1",
        name: " 任务一 ",
        device: "D1",
        operators: "Op1",
        duration: 30,
        earliestStart: "08:00",
        due: "12:00",
        priority: 5,
        value: 10,
        mandatory: true,
        dependsOn: null
      }
    ]
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.devices[0].name, "设备A");
  assert.equal(r.operators[0].name, "操作员");
  assert.equal(r.tasks[0].name, "任务一");
});

test("normalizeInput: duplicate task IDs", () => {
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-18:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-18:00" }],
    [
      {
        id: "T1",
        name: "A",
        device: "D1",
        operators: "Op1",
        duration: 30,
        earliestStart: "08:00",
        due: "12:00",
        priority: 5,
        value: 1,
        mandatory: true,
        dependsOn: null
      },
      {
        id: "T1",
        name: "B",
        device: "D1",
        operators: "Op1",
        duration: 30,
        earliestStart: "08:00",
        due: "12:00",
        priority: 5,
        value: 1,
        mandatory: true,
        dependsOn: null
      }
    ]
  );
  assert.ok(r.errors.some((e) => e.code === "DUPLICATE_ID"));
});

test("normalizeInput: cycle dependency", () => {
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-18:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-18:00" }],
    [
      {
        id: "TA",
        name: "A",
        device: "D1",
        operators: "Op1",
        duration: 30,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 1,
        mandatory: true,
        dependsOn: "TB"
      },
      {
        id: "TB",
        name: "B",
        device: "D1",
        operators: "Op1",
        duration: 30,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 1,
        mandatory: true,
        dependsOn: "TA"
      }
    ]
  );
  assert.ok(r.errors.some((e) => e.code === "CYCLE_DEPENDENCY"));
});

test("normalizeInput: sample raw data has no errors", async () => {
  const { rawDevices, rawOperators, rawTasks } = await import("../src/data.js");
  const r = normalizeInput(rawDevices, rawOperators, rawTasks);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors, null, 2));
  assert.equal(r.tasks.length, 8);
  assert.equal(r.devices.length, 3);
});
