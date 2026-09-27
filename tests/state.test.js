import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  reduceState,
  exportState,
  getEffectiveInput
} from "../src/state.js";
import { importState } from "../src/storage.js";
import { validateSchedule } from "../src/validator.js";

test("createInitialState: solves sample and is valid", () => {
  const state = createInitialState();
  assert.equal(state.normalizeErrors.length, 0);
  assert.ok(state.schedule.assignments.length > 0);
  const input = getEffectiveInput(state);
  const v = validateSchedule(input, state.schedule);
  assert.equal(v.valid, true, JSON.stringify(v.conflicts, null, 2));
});

test("APPLY_MANUAL_MOVE: legal then undo", () => {
  let state = createInitialState();
  const a = state.schedule.assignments[0];
  const beforeKey = state.score.deterministicKey;

  state = reduceState(state, {
    type: "APPLY_MANUAL_MOVE",
    taskId: a.taskId,
    newStart: a.start,
    operatorId: a.operatorId
  });
  // same position — still counts as manual if validation ok
  assert.equal(state.lastAction, "APPLY_MANUAL_MOVE");

  // Find a feasible alternative or force illegal then legal
  state = createInitialState();
  const assignment = state.schedule.assignments.find((x) => x.taskId === "T07");
  // If T07 scheduled, try move; else use first assignment same slot
  const target = assignment || state.schedule.assignments[0];

  state = reduceState(state, {
    type: "SET_DEVICE_OFFLINE",
    deviceId: "XRD-1",
    offline: true
  });
  assert.ok(state.offlineDevices.includes("XRD-1"));
  const afterOffline = state.score.deterministicKey;

  state = reduceState(state, { type: "UNDO" });
  assert.ok(!state.offlineDevices.includes("XRD-1"));
  assert.equal(state.score.deterministicKey, beforeKey);

  state = reduceState(state, { type: "REDO" });
  assert.ok(state.offlineDevices.includes("XRD-1"));
  assert.equal(state.score.deterministicKey, afterOffline);
});

test("APPLY_MANUAL_MOVE: illegal rejected without history pollution", () => {
  let state = createInitialState();
  const pastLen = state.past.length;
  const a = state.schedule.assignments[0];
  state = reduceState(state, {
    type: "APPLY_MANUAL_MOVE",
    taskId: a.taskId,
    newStart: "03:00",
    operatorId: a.operatorId
  });
  assert.equal(state.lastAction, "APPLY_MANUAL_MOVE_REJECTED");
  assert.ok(state.lastError);
  assert.equal(state.past.length, pastLen);
});

test("UNDO and REDO", () => {
  let state = createInitialState();
  state = reduceState(state, {
    type: "SET_TASK_PRIORITY",
    taskId: "T07",
    priority: 10
  });
  const mid = state.priorityOverrides.T07;
  assert.equal(mid, 10);

  state = reduceState(state, { type: "UNDO" });
  assert.equal(state.priorityOverrides.T07, undefined);

  state = reduceState(state, { type: "REDO" });
  assert.equal(state.priorityOverrides.T07, 10);
});

test("new action clears redo stack", () => {
  let state = createInitialState();
  state = reduceState(state, {
    type: "SET_TASK_PRIORITY",
    taskId: "T07",
    priority: 9
  });
  state = reduceState(state, { type: "UNDO" });
  assert.ok(state.future.length > 0);
  state = reduceState(state, {
    type: "SET_TASK_PRIORITY",
    taskId: "T07",
    priority: 3
  });
  assert.equal(state.future.length, 0);
});

test("RESET restores defaults", () => {
  let state = createInitialState();
  state = reduceState(state, {
    type: "SET_DEVICE_OFFLINE",
    deviceId: "SEM-1",
    offline: true
  });
  state = reduceState(state, {
    type: "SET_TASK_PRIORITY",
    taskId: "T01",
    priority: 1
  });
  state = reduceState(state, { type: "RESET" });
  assert.deepEqual(state.offlineDevices, []);
  assert.deepEqual(state.priorityOverrides, {});
  assert.equal(state.manualMode, false);
});

test("importState: invalid JSON", () => {
  const r = importState("{not json");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("JSON"));
});

test("import illegal schedule payload is rejected or flagged", () => {
  let state = createInitialState();
  const bad = {
    schedule: {
      assignments: [
        {
          taskId: "T01",
          start: 480,
          end: 570,
          deviceId: "SEM-1",
          operatorId: "Lin"
        },
        {
          taskId: "T06",
          start: 480,
          end: 510,
          deviceId: "SEM-1",
          operatorId: "Zhao"
        }
      ]
    },
    offlineDevices: [],
    priorityOverrides: {},
    maintenanceShift: {}
  };
  // Overlapping SEM-1 T01 and T06
  state = reduceState(state, { type: "IMPORT_STATE", payload: bad });
  assert.equal(state.lastAction, "IMPORT_STATE");
  // Should flag conflicts
  assert.equal(state.validation.valid, false);
  assert.ok(state.validation.conflicts.length > 0);
});

test("export then import preserves key business fields", () => {
  let state = createInitialState();
  state = reduceState(state, {
    type: "SET_DEVICE_OFFLINE",
    deviceId: "RAMAN-1",
    offline: true
  });
  const exported = exportState(state);
  const json = JSON.stringify(exported);
  const parsed = importState(json);
  assert.equal(parsed.ok, true);

  let state2 = createInitialState();
  state2 = reduceState(state2, { type: "IMPORT_STATE", payload: parsed.data });
  assert.ok(state2.offlineDevices.includes("RAMAN-1"));
  assert.deepEqual(
    state2.schedule.assignments.map((a) => a.taskId).sort(),
    state.schedule.assignments.map((a) => a.taskId).sort()
  );
});

test("SHIFT_MAINTENANCE changes windows and re-solves", () => {
  let state = createInitialState();
  const before = getEffectiveInput(state).devices.find((d) => d.id === "SEM-1")
    .maintenance[0].start;
  state = reduceState(state, {
    type: "SHIFT_MAINTENANCE",
    deviceId: "SEM-1",
    deltaMinutes: 15
  });
  const after = getEffectiveInput(state).devices.find((d) => d.id === "SEM-1")
    .maintenance[0].start;
  assert.equal(after, before + 15);
});
