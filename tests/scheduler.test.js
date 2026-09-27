import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInput } from "../src/normalize.js";
import { solveSchedule, applyManualMove } from "../src/scheduler.js";
import { validateSchedule, scoreSchedule, compareScores } from "../src/validator.js";
import { rawDevices, rawOperators, rawTasks } from "../src/data.js";

function sampleInput() {
  const r = normalizeInput(rawDevices, rawOperators, rawTasks);
  assert.equal(r.errors.length, 0);
  return {
    devices: r.devices,
    operators: r.operators,
    tasks: r.tasks
  };
}

test("solveSchedule: sample data produces valid schedule", () => {
  const input = sampleInput();
  const result = solveSchedule(input);
  const v = validateSchedule(input, result);
  assert.equal(v.valid, true, JSON.stringify(v.conflicts, null, 2));
  assert.ok(result.assignments.length > 0);
  assert.ok(result.score.mandatoryCount >= 1);
  assert.ok(result.explanation.length > 0);
});

test("solveSchedule: deterministic on same input", () => {
  const input = sampleInput();
  const a = solveSchedule(input);
  const b = solveSchedule(input);
  assert.equal(a.score.deterministicKey, b.score.deterministicKey);
  assert.deepEqual(a.assignments, b.assignments);
});

test("solveSchedule: independent of task input order", () => {
  const base = sampleInput();
  const shuffled = {
    ...base,
    tasks: [...base.tasks].reverse()
  };
  const a = solveSchedule(base);
  const b = solveSchedule(shuffled);
  assert.equal(a.score.deterministicKey, b.score.deterministicKey);
  assert.deepEqual(
    a.assignments.map((x) => x.taskId).sort(),
    b.assignments.map((x) => x.taskId).sort()
  );
});

test("solveSchedule: prefers more mandatory tasks", () => {
  // Two optional low-value tasks vs one mandatory high — force trade-off on single device
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-10:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-10:00" }],
    [
      {
        id: "M1",
        name: "Mand",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "10:00",
        priority: 1,
        value: 1,
        mandatory: true,
        dependsOn: null
      },
      {
        id: "O1",
        name: "Opt1",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "10:00",
        priority: 10,
        value: 100,
        mandatory: false,
        dependsOn: null
      },
      {
        id: "O2",
        name: "Opt2",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "09:00",
        due: "10:00",
        priority: 10,
        value: 100,
        mandatory: false,
        dependsOn: null
      }
    ]
  );
  assert.equal(r.errors.length, 0);
  const input = { devices: r.devices, operators: r.operators, tasks: r.tasks };
  const result = solveSchedule(input);
  assert.equal(result.score.mandatoryCount, 1);
  assert.ok(result.assignments.some((a) => a.taskId === "M1"));
});

test("solveSchedule: value objective when priority equal", () => {
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-09:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-09:00" }],
    [
      {
        id: "A",
        name: "A",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 10,
        mandatory: false,
        dependsOn: null
      },
      {
        id: "B",
        name: "B",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 50,
        mandatory: false,
        dependsOn: null
      }
    ]
  );
  const input = { devices: r.devices, operators: r.operators, tasks: r.tasks };
  const result = solveSchedule(input);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].taskId, "B");
  assert.equal(result.score.valueSum, 50);
});

test("solveSchedule: weighted tardiness preference", () => {
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-12:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-12:00" }],
    [
      {
        id: "T1",
        name: "T1",
        device: "D1",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "09:00",
        priority: 5,
        value: 10,
        mandatory: true,
        dependsOn: null
      }
    ]
  );
  const input = { devices: r.devices, operators: r.operators, tasks: r.tasks };
  const result = solveSchedule(input);
  // Should start ASAP at 08:00 to minimize tardiness (due 09:00, end 09:00 → 0)
  assert.equal(result.assignments[0].start, 480);
  assert.equal(result.score.weightedTardiness, 0);
});

test("solveSchedule: deterministic key tie-break", () => {
  // Two identical tasks except id — same metrics, prefer lex smaller key
  const r = normalizeInput(
    [
      {
        id: "D1",
        name: "D",
        available: "08:00-10:00",
        maintenance: []
      }
    ],
    [
      { id: "OpA", name: "A", available: "08:00-10:00" },
      { id: "OpB", name: "B", available: "08:00-10:00" }
    ],
    [
      {
        id: "T1",
        name: "T1",
        device: "D1",
        operators: ["OpA", "OpB"],
        duration: 60,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 10,
        mandatory: true,
        dependsOn: null
      }
    ]
  );
  const input = { devices: r.devices, operators: r.operators, tasks: r.tasks };
  const result = solveSchedule(input);
  // Operators sorted OpA then OpB; starts from earliest — key should use OpA
  assert.equal(result.assignments[0].operatorId, "OpA");
  assert.ok(result.score.deterministicKey.includes("T1@08:00#OpA"));
});

test("compareScores: lexicographic order", () => {
  const worse = {
    mandatoryCount: 1,
    prioritySum: 10,
    valueSum: 100,
    weightedTardiness: 0,
    makespan: 600,
    idleFragments: 0,
    deterministicKey: "a"
  };
  const better = {
    mandatoryCount: 2,
    prioritySum: 1,
    valueSum: 1,
    weightedTardiness: 999,
    makespan: 999,
    idleFragments: 9,
    deterministicKey: "z"
  };
  assert.ok(compareScores(better, worse) > 0);
});

test("applyManualMove: legal move accepted", () => {
  const input = sampleInput();
  const solved = solveSchedule(input);
  const target = solved.assignments[0];
  // Move to same slot should be ok
  const moved = applyManualMove(
    input,
    { assignments: solved.assignments },
    target.taskId,
    target.start,
    target.operatorId
  );
  assert.equal(moved.ok, true);
});

test("applyManualMove: illegal move rejected", () => {
  const input = sampleInput();
  const solved = solveSchedule(input);
  const target = solved.assignments[0];
  const moved = applyManualMove(
    input,
    { assignments: solved.assignments },
    target.taskId,
    "03:00",
    target.operatorId
  );
  assert.equal(moved.ok, false);
  assert.ok(moved.conflicts.length > 0);
  assert.deepEqual(moved.schedule.assignments, solved.assignments);
});
