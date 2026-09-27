/**
 * Schedule validation against hard constraints.
 */

import { WORKDAY_START, WORKDAY_END, GRID, minutesToTime } from "./normalize.js";

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function coversInterval(availList, start, end) {
  return availList.some((iv) => iv.start <= start && iv.end >= end);
}

function overlapsAny(list, start, end) {
  return list.some((iv) => intervalsOverlap(start, end, iv.start, iv.end));
}

/**
 * Build lookup maps from normalized input (may include offline flags and shifted maintenance).
 */
function indexInput(input) {
  const devices = new Map((input.devices || []).map((d) => [d.id, d]));
  const operators = new Map((input.operators || []).map((o) => [o.id, o]));
  const tasks = new Map((input.tasks || []).map((t) => [t.id, t]));
  return { devices, operators, tasks };
}

/**
 * validateSchedule(input, schedule, options)
 * schedule: { assignments: [...], unscheduledTaskIds?: [...] }
 */
export function validateSchedule(input, schedule, options = {}) {
  const conflicts = [];
  const { devices, operators, tasks } = indexInput(input);
  const assignments = Array.isArray(schedule?.assignments)
    ? schedule.assignments
    : [];
  const offlineDevices = new Set(
    options.offlineDevices ||
      [...devices.values()].filter((d) => d.offline).map((d) => d.id)
  );

  const byTask = new Map();
  for (const a of assignments) {
    if (!a || a.taskId == null) {
      conflicts.push({
        type: "INVALID_ASSIGNMENT",
        taskIds: [],
        resourceId: null,
        message: "存在缺少 taskId 的分配项"
      });
      continue;
    }
    if (byTask.has(a.taskId)) {
      conflicts.push({
        type: "DUPLICATE_ASSIGNMENT",
        taskIds: [a.taskId],
        resourceId: null,
        message: `任务 ${a.taskId} 被分配了多次`
      });
    }
    byTask.set(a.taskId, a);
  }

  for (const a of assignments) {
    if (!a?.taskId) continue;
    const task = tasks.get(a.taskId);
    if (!task) {
      conflicts.push({
        type: "UNKNOWN_TASK",
        taskIds: [a.taskId],
        resourceId: null,
        message: `未知任务 ${a.taskId}`
      });
      continue;
    }

    const start = a.start;
    const end = a.end;
    const deviceId = a.deviceId ?? task.deviceId;
    const operatorId = a.operatorId;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      conflicts.push({
        type: "INVALID_TIME",
        taskIds: [task.id],
        resourceId: null,
        message: `任务 ${task.id} 开始/结束时间非法`
      });
      continue;
    }

    if (start % GRID !== 0 || end % GRID !== 0) {
      conflicts.push({
        type: "GRID_ALIGNMENT",
        taskIds: [task.id],
        resourceId: null,
        message: `任务 ${task.id} 时间未对齐 15 分钟网格`
      });
    }

    if (end - start !== task.duration) {
      conflicts.push({
        type: "DURATION_MISMATCH",
        taskIds: [task.id],
        resourceId: null,
        message: `任务 ${task.id} 分配时长与任务时长不一致`
      });
    }

    if (start < task.earliestStart) {
      conflicts.push({
        type: "EARLIEST_START",
        taskIds: [task.id],
        resourceId: null,
        message: `任务 ${task.id} 开始早于 earliestStart（${minutesToTime(task.earliestStart)}）`
      });
    }

    if (start < WORKDAY_START || end > WORKDAY_END) {
      conflicts.push({
        type: "WORKDAY_BOUNDS",
        taskIds: [task.id],
        resourceId: null,
        message: `任务 ${task.id} 超出工作日范围 08:00—18:00`
      });
    }

    if (offlineDevices.has(deviceId)) {
      conflicts.push({
        type: "DEVICE_OFFLINE",
        taskIds: [task.id],
        resourceId: deviceId,
        message: `任务 ${task.id} 所在设备 ${deviceId} 已离线`
      });
    }

    const device = devices.get(deviceId);
    if (!device) {
      conflicts.push({
        type: "UNKNOWN_DEVICE",
        taskIds: [task.id],
        resourceId: deviceId,
        message: `任务 ${task.id} 未知设备 ${deviceId}`
      });
    } else {
      if (!coversInterval(device.available, start, end)) {
        conflicts.push({
          type: "DEVICE_UNAVAILABLE",
          taskIds: [task.id],
          resourceId: deviceId,
          message: `任务 ${task.id} 不在设备 ${deviceId} 可用时间内`
        });
      }
      if (overlapsAny(device.maintenance || [], start, end)) {
        conflicts.push({
          type: "DEVICE_MAINTENANCE",
          taskIds: [task.id],
          resourceId: deviceId,
          message: `任务 ${task.id} 与设备 ${deviceId} 维护窗口重叠`
        });
      }
    }

    if (!operatorId || !task.operators.includes(operatorId)) {
      conflicts.push({
        type: "OPERATOR_NOT_CANDIDATE",
        taskIds: [task.id],
        resourceId: operatorId ?? null,
        message: `任务 ${task.id} 的操作人员 ${operatorId ?? "(空)"} 不在候选列表中`
      });
    } else {
      const op = operators.get(operatorId);
      if (!op) {
        conflicts.push({
          type: "UNKNOWN_OPERATOR",
          taskIds: [task.id],
          resourceId: operatorId,
          message: `任务 ${task.id} 未知操作人员 ${operatorId}`
        });
      } else if (!coversInterval(op.available, start, end)) {
        conflicts.push({
          type: "OPERATOR_UNAVAILABLE",
          taskIds: [task.id],
          resourceId: operatorId,
          message: `任务 ${task.id} 不在操作人员 ${operatorId} 可用时间内`
        });
      }
    }

    // Dependencies
    for (const depId of task.dependsOn) {
      const depA = byTask.get(depId);
      if (!depA) {
        conflicts.push({
          type: "DEPENDENCY_UNSCHEDULED",
          taskIds: [task.id, depId],
          resourceId: null,
          message: `任务 ${task.id} 的前置任务 ${depId} 未安排`
        });
      } else if (start < depA.end) {
        conflicts.push({
          type: "DEPENDENCY_ORDER",
          taskIds: [task.id, depId],
          resourceId: null,
          message: `任务 ${task.id} 开始早于前置任务 ${depId} 结束`
        });
      }
    }
  }

  // Device overlaps
  const byDevice = new Map();
  for (const a of assignments) {
    if (!a?.taskId || !Number.isFinite(a.start)) continue;
    const deviceId = a.deviceId ?? tasks.get(a.taskId)?.deviceId;
    if (!deviceId) continue;
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
    byDevice.get(deviceId).push(a);
  }
  for (const [deviceId, list] of byDevice) {
    const sorted = [...list].sort((x, y) => x.start - y.start || x.taskId.localeCompare(y.taskId));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].start >= sorted[i].end) break;
        if (intervalsOverlap(sorted[i].start, sorted[i].end, sorted[j].start, sorted[j].end)) {
          conflicts.push({
            type: "DEVICE_OVERLAP",
            taskIds: [sorted[i].taskId, sorted[j].taskId],
            resourceId: deviceId,
            message: `设备 ${deviceId} 上任务 ${sorted[i].taskId} 与 ${sorted[j].taskId} 时间重叠`
          });
        }
      }
    }
  }

  // Operator overlaps
  const byOp = new Map();
  for (const a of assignments) {
    if (!a?.taskId || !Number.isFinite(a.start) || !a.operatorId) continue;
    if (!byOp.has(a.operatorId)) byOp.set(a.operatorId, []);
    byOp.get(a.operatorId).push(a);
  }
  for (const [opId, list] of byOp) {
    const sorted = [...list].sort((x, y) => x.start - y.start || x.taskId.localeCompare(y.taskId));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j].start >= sorted[i].end) break;
        if (intervalsOverlap(sorted[i].start, sorted[i].end, sorted[j].start, sorted[j].end)) {
          conflicts.push({
            type: "OPERATOR_OVERLAP",
            taskIds: [sorted[i].taskId, sorted[j].taskId],
            resourceId: opId,
            message: `操作人员 ${opId} 上任务 ${sorted[i].taskId} 与 ${sorted[j].taskId} 时间重叠`
          });
        }
      }
    }
  }

  return {
    valid: conflicts.length === 0,
    conflicts
  };
}

/**
 * scoreSchedule(input, schedule) — 7-level lexicographic score
 */
export function scoreSchedule(input, schedule) {
  const tasks = new Map((input.tasks || []).map((t) => [t.id, t]));
  const devices = input.devices || [];
  const assignments = Array.isArray(schedule?.assignments)
    ? [...schedule.assignments]
    : [];

  let mandatoryCount = 0;
  let prioritySum = 0;
  let valueSum = 0;
  let weightedTardiness = 0;
  let makespan = 0;
  let scheduledCount = 0;

  for (const a of assignments) {
    const task = tasks.get(a.taskId);
    if (!task) continue;
    scheduledCount += 1;
    if (task.mandatory) mandatoryCount += 1;
    prioritySum += task.priority;
    valueSum += task.value;
    const tard = Math.max(0, a.end - task.due);
    weightedTardiness += tard * task.priority;
    if (a.end > makespan) makespan = a.end;
  }

  // Idle fragments per device (gaps between consecutive scheduled tasks)
  let idleFragments = 0;
  const byDevice = new Map();
  for (const a of assignments) {
    const task = tasks.get(a.taskId);
    const deviceId = a.deviceId ?? task?.deviceId;
    if (!deviceId) continue;
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
    byDevice.get(deviceId).push(a);
  }
  for (const [, list] of byDevice) {
    const sorted = [...list].sort((x, y) => x.start - y.start || x.taskId.localeCompare(y.taskId));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].start > sorted[i].end) {
        idleFragments += 1;
      }
    }
  }

  // Deterministic key: tasks sorted by ID
  const keyParts = [...assignments]
    .filter((a) => tasks.has(a.taskId))
    .sort((a, b) => a.taskId.localeCompare(b.taskId))
    .map(
      (a) =>
        `${a.taskId}@${minutesToTime(a.start)}#${a.operatorId ?? ""}`
    );
  const deterministicKey = keyParts.join("|");

  const allTaskIds = new Set(tasks.keys());
  const scheduledIds = new Set(assignments.map((a) => a.taskId));
  const unscheduledTaskIds = [...allTaskIds]
    .filter((id) => !scheduledIds.has(id))
    .sort((a, b) => a.localeCompare(b));

  // Utilization: scheduled device-minutes / available device-minutes in workday windows
  let busy = 0;
  let capacity = 0;
  for (const d of devices) {
    for (const iv of d.available || []) {
      capacity += Math.max(0, iv.end - iv.start);
    }
  }
  for (const a of assignments) {
    if (Number.isFinite(a.start) && Number.isFinite(a.end)) {
      busy += a.end - a.start;
    }
  }
  const utilization = capacity > 0 ? busy / capacity : 0;

  return {
    mandatoryCount,
    scheduledCount,
    prioritySum,
    valueSum,
    weightedTardiness,
    makespan,
    idleFragments,
    deterministicKey,
    unscheduledCount: unscheduledTaskIds.length,
    unscheduledTaskIds,
    utilization,
    // For lexicographic comparison (maximize first 3, minimize rest)
    metrics: [
      mandatoryCount,
      prioritySum,
      valueSum,
      -weightedTardiness,
      -makespan,
      -idleFragments,
      // key compared separately as string
    ]
  };
}

/**
 * Compare two scores: return positive if a is better than b.
 */
export function compareScores(scoreA, scoreB) {
  const keys = [
    "mandatoryCount",
    "prioritySum",
    "valueSum",
    "weightedTardiness",
    "makespan",
    "idleFragments"
  ];
  const maximize = [true, true, true, false, false, false];
  for (let i = 0; i < keys.length; i++) {
    const av = scoreA[keys[i]];
    const bv = scoreB[keys[i]];
    if (av === bv) continue;
    if (maximize[i]) return av > bv ? 1 : -1;
    return av < bv ? 1 : -1;
  }
  const ka = scoreA.deterministicKey || "";
  const kb = scoreB.deterministicKey || "";
  if (ka < kb) return 1;
  if (ka > kb) return -1;
  return 0;
}

/**
 * Check if a candidate assignment is feasible given current placements.
 * Used by solver for incremental validation (faster than full validate).
 */
export function isFeasiblePlacement(input, task, start, operatorId, placed, offlineDevices) {
  const end = start + task.duration;
  if (start % GRID !== 0) return false;
  if (start < task.earliestStart) return false;
  if (start < WORKDAY_START || end > WORKDAY_END) return false;
  if (offlineDevices.has(task.deviceId)) return false;
  if (!task.operators.includes(operatorId)) return false;

  const device = input.devices.find((d) => d.id === task.deviceId);
  if (!device) return false;
  if (!coversInterval(device.available, start, end)) return false;
  if (overlapsAny(device.maintenance || [], start, end)) return false;

  const op = input.operators.find((o) => o.id === operatorId);
  if (!op) return false;
  if (!coversInterval(op.available, start, end)) return false;

  for (const depId of task.dependsOn) {
    const dep = placed.get(depId);
    if (!dep) return false;
    if (start < dep.end) return false;
  }

  for (const [, a] of placed) {
    if (a.deviceId === task.deviceId && intervalsOverlap(start, end, a.start, a.end)) {
      return false;
    }
    if (a.operatorId === operatorId && intervalsOverlap(start, end, a.start, a.end)) {
      return false;
    }
  }

  return true;
}
