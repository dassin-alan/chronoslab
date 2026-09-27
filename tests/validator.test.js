import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInput } from "../src/normalize.js";
import { validateSchedule, scoreSchedule } from "../src/validator.js";

function miniInput(overrides = {}) {
  const base = normalizeInput(
    [
      {
        id: "D1",
        name: "Dev",
        available: "08:00-18:00",
        maintenance: [{ start: "12:00", end: "13:00" }]
      }
    ],
    [
      {
        id: "Op1",
        name: "Op",
        available: [
          ["08:00", "12:00"],
          ["13:00", "18:00"]
        ]
      },
      {
        id: "Op2",
        name: "Op2",
        available: "08:00-18:00"
      }
    ],
    [
      {
        id: "T1",
        name: "T1",
        device: "D1",
        operators: ["Op1"],
        duration: 60,
        earliestStart: "08:00",
        due: "12:00",
        priority: 5,
        value: 10,
        mandatory: true,
        dependsOn: null
      },
      {
        id: "T2",
        name: "T2",
        device: "D1",
        operators: ["Op1"],
        duration: 60,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 10,
        mandatory: true,
        dependsOn: "T1"
      }
    ]
  );
  assert.equal(base.errors.length, 0);
  return {
    devices: base.devices.map((d) => ({ ...d, ...overrides.device })),
    operators: base.operators,
    tasks: base.tasks
  };
}

test("validate: device task overlap", () => {
  const input = miniInput();
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 480,
        end: 540,
        deviceId: "D1",
        operatorId: "Op1"
      },
      {
        taskId: "T2",
        start: 510,
        end: 570,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(input, schedule);
  assert.equal(r.valid, false);
  assert.ok(r.conflicts.some((c) => c.type === "DEVICE_OVERLAP"));
});

test("validate: operator overlap on different devices", () => {
  const base = normalizeInput(
    [
      {
        id: "D1",
        name: "D1",
        available: "08:00-18:00",
        maintenance: []
      },
      {
        id: "D2",
        name: "D2",
        available: "08:00-18:00",
        maintenance: []
      }
    ],
    [{ id: "Op1", name: "O", available: "08:00-18:00" }],
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
        value: 1,
        mandatory: true,
        dependsOn: null
      },
      {
        id: "B",
        name: "B",
        device: "D2",
        operators: "Op1",
        duration: 60,
        earliestStart: "08:00",
        due: "18:00",
        priority: 5,
        value: 1,
        mandatory: true,
        dependsOn: null
      }
    ]
  );
  const schedule = {
    assignments: [
      {
        taskId: "A",
        start: 480,
        end: 540,
        deviceId: "D1",
        operatorId: "Op1"
      },
      {
        taskId: "B",
        start: 500,
        end: 560,
        deviceId: "D2",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(base, schedule);
  assert.equal(r.valid, false);
  assert.ok(r.conflicts.some((c) => c.type === "OPERATOR_OVERLAP"));
});

test("validate: device maintenance conflict", () => {
  const input = miniInput();
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 11 * 60 + 30,
        end: 12 * 60 + 30,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(input, schedule);
  assert.equal(r.valid, false);
  assert.ok(r.conflicts.some((c) => c.type === "DEVICE_MAINTENANCE"));
});

test("validate: operator unavailable window", () => {
  const input = miniInput();
  // Op1 unavailable 12:00-13:00
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 12 * 60,
        end: 13 * 60,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(input, schedule);
  assert.equal(r.valid, false);
  assert.ok(
    r.conflicts.some(
      (c) =>
        c.type === "OPERATOR_UNAVAILABLE" || c.type === "DEVICE_MAINTENANCE"
    )
  );
});

test("validate: dependency not finished", () => {
  const input = miniInput();
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 480,
        end: 540,
        deviceId: "D1",
        operatorId: "Op1"
      },
      {
        taskId: "T2",
        start: 500,
        end: 560,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(input, schedule);
  assert.equal(r.valid, false);
  assert.ok(
    r.conflicts.some(
      (c) => c.type === "DEPENDENCY_ORDER" || c.type === "DEVICE_OVERLAP"
    )
  );
});

test("validate: offline device", () => {
  const input = miniInput();
  input.devices[0].offline = true;
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 480,
        end: 540,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  const r = validateSchedule(input, schedule, { offlineDevices: ["D1"] });
  assert.equal(r.valid, false);
  assert.ok(r.conflicts.some((c) => c.type === "DEVICE_OFFLINE"));
});

test("scoreSchedule: weighted tardiness", () => {
  const input = miniInput();
  const schedule = {
    assignments: [
      {
        taskId: "T1",
        start: 10 * 60,
        end: 11 * 60,
        deviceId: "D1",
        operatorId: "Op1"
      }
    ]
  };
  // due 12:00, end 11:00 → 0 tardiness
  let s = scoreSchedule(input, schedule);
  assert.equal(s.weightedTardiness, 0);

  schedule.assignments[0] = {
    taskId: "T1",
    start: 12 * 60,
    end: 13 * 60,
    deviceId: "D1",
    operatorId: "Op1"
  };
  // due 12:00, end 13:00 → 60 * priority 5
  s = scoreSchedule(input, schedule);
  assert.equal(s.weightedTardiness, 60 * 5);
});
