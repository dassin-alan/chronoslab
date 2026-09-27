/**
 * Predictable state management with undo/redo (20 steps).
 */

import { normalizeInput } from "./normalize.js";
import { solveSchedule, applyManualMove } from "./scheduler.js";
import { scoreSchedule, validateSchedule } from "./validator.js";
import { rawDevices, rawOperators, rawTasks } from "./data.js";

const HISTORY_LIMIT = 20;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildWorkingInput(baseInput, meta) {
  const input = deepClone(baseInput);
  const offline = new Set(meta.offlineDevices || []);
  const priorityOverrides = meta.priorityOverrides || {};
  const maintenanceShift = meta.maintenanceShift || {};

  for (const d of input.devices) {
    d.offline = offline.has(d.id);
    const shift = maintenanceShift[d.id] || 0;
    if (shift !== 0 && d.maintenance) {
      d.maintenance = d.maintenance.map((iv) => ({
        start: iv.start + shift,
        end: iv.end + shift
      }));
    }
  }

  for (const t of input.tasks) {
    if (Object.prototype.hasOwnProperty.call(priorityOverrides, t.id)) {
      const p = Number(priorityOverrides[t.id]);
      if (Number.isFinite(p)) {
        t.priority = Math.min(10, Math.max(1, Math.round(p)));
      }
    }
  }

  return input;
}

function snapshotBusiness(state) {
  return {
    schedule: deepClone(state.schedule),
    offlineDevices: [...state.offlineDevices].sort(),
    priorityOverrides: { ...state.priorityOverrides },
    maintenanceShift: { ...state.maintenanceShift },
    lastSolveMs: state.lastSolveMs,
    explanation: state.explanation,
    lastAction: state.lastAction,
    manualMode: state.manualMode
  };
}

function restoreBusiness(state, snap) {
  state.schedule = deepClone(snap.schedule);
  state.offlineDevices = [...snap.offlineDevices];
  state.priorityOverrides = { ...snap.priorityOverrides };
  state.maintenanceShift = { ...snap.maintenanceShift };
  state.lastSolveMs = snap.lastSolveMs;
  state.explanation = snap.explanation;
  state.lastAction = snap.lastAction;
  state.manualMode = snap.manualMode;
}

function pushHistory(state) {
  state.past.push(snapshotBusiness(state));
  if (state.past.length > HISTORY_LIMIT) {
    state.past.shift();
  }
  state.future = [];
}

function recomputeValidation(state) {
  const input = getEffectiveInput(state);
  const v = validateSchedule(input, state.schedule);
  state.validation = v;
  state.score = scoreSchedule(input, state.schedule);
  return input;
}

export function getEffectiveInput(state) {
  return buildWorkingInput(state.baseInput, {
    offlineDevices: state.offlineDevices,
    priorityOverrides: state.priorityOverrides,
    maintenanceShift: state.maintenanceShift
  });
}

function runSolve(state) {
  const input = getEffectiveInput(state);
  const result = solveSchedule(input, {
    offlineDevices: state.offlineDevices
  });
  state.schedule = {
    assignments: result.assignments,
    unscheduledTaskIds: result.unscheduledTaskIds
  };
  state.score = result.score;
  state.explanation = result.explanation;
  state.lastSolveMs = result.stats.elapsedMs;
  state.manualMode = false;
  state.validation = validateSchedule(input, state.schedule);
  state.lastError = null;
  return result;
}

/**
 * createInitialState(input?) — if no input, uses sample raw data.
 */
export function createInitialState(input) {
  let baseInput;
  let errors = [];

  if (input && input.devices && input.operators && input.tasks) {
    baseInput = deepClone(input);
    errors = input.errors || [];
  } else {
    const normalized = normalizeInput(rawDevices, rawOperators, rawTasks);
    baseInput = {
      devices: normalized.devices,
      operators: normalized.operators,
      tasks: normalized.tasks
    };
    errors = normalized.errors;
  }

  // Store original maintenance for reset of shifts
  const originalMaintenance = {};
  for (const d of baseInput.devices) {
    originalMaintenance[d.id] = (d.maintenance || []).map((iv) => ({ ...iv }));
  }

  const state = {
    baseInput,
    originalMaintenance,
    normalizeErrors: errors,
    offlineDevices: [],
    priorityOverrides: {},
    maintenanceShift: {},
    schedule: { assignments: [], unscheduledTaskIds: [] },
    score: null,
    validation: { valid: true, conflicts: [] },
    explanation: "",
    lastSolveMs: 0,
    lastAction: "INIT",
    lastError: null,
    manualMode: false,
    past: [],
    future: [],
    theme: "dark",
    status: "idle",
    testSummary: null
  };

  if (errors.length === 0) {
    runSolve(state);
    state.lastAction = "SOLVE";
  } else {
    state.lastError = {
      message: `数据规范化存在 ${errors.length} 个错误`,
      details: errors
    };
    state.status = "error";
  }

  return state;
}

/**
 * reduceState(state, action) — pure-ish: mutates a clone and returns new state.
 */
export function reduceState(state, action) {
  const next = {
    ...state,
    past: [...state.past],
    future: [...state.future],
    offlineDevices: [...state.offlineDevices],
    priorityOverrides: { ...state.priorityOverrides },
    maintenanceShift: { ...state.maintenanceShift },
    schedule: deepClone(state.schedule),
    lastError: null
  };

  const type = action?.type;
  if (!type) {
    next.lastError = { message: "缺少 action.type" };
    return next;
  }

  try {
    switch (type) {
      case "SOLVE": {
        pushHistory(next);
        next.status = "computing";
        runSolve(next);
        next.status = "ready";
        next.lastAction = "SOLVE";
        break;
      }

      case "SET_DEVICE_OFFLINE": {
        const { deviceId, offline } = action;
        if (!deviceId) {
          next.lastError = { message: "缺少 deviceId" };
          return next;
        }
        pushHistory(next);
        const set = new Set(next.offlineDevices);
        if (offline) set.add(deviceId);
        else set.delete(deviceId);
        next.offlineDevices = [...set].sort();
        runSolve(next);
        next.status = "ready";
        next.lastAction = "SET_DEVICE_OFFLINE";
        break;
      }

      case "SET_TASK_PRIORITY": {
        const { taskId, priority } = action;
        const p = Number(priority);
        if (!taskId || !Number.isFinite(p)) {
          next.lastError = { message: "SET_TASK_PRIORITY 参数无效" };
          return next;
        }
        pushHistory(next);
        next.priorityOverrides[taskId] = Math.min(10, Math.max(1, Math.round(p)));
        runSolve(next);
        next.status = "ready";
        next.lastAction = "SET_TASK_PRIORITY";
        break;
      }

      case "SHIFT_MAINTENANCE": {
        const { deviceId, deltaMinutes, reset } = action;
        if (!deviceId) {
          next.lastError = { message: "缺少 deviceId" };
          return next;
        }
        pushHistory(next);
        if (reset) {
          delete next.maintenanceShift[deviceId];
        } else {
          const delta = Number(deltaMinutes) || 0;
          next.maintenanceShift[deviceId] =
            (next.maintenanceShift[deviceId] || 0) + delta;
        }
        runSolve(next);
        next.status = "ready";
        next.lastAction = "SHIFT_MAINTENANCE";
        break;
      }

      case "APPLY_MANUAL_MOVE": {
        const { taskId, newStart, operatorId } = action;
        const input = getEffectiveInput(next);
        const result = applyManualMove(
          input,
          next.schedule,
          taskId,
          newStart,
          operatorId
        );
        if (!result.ok) {
          next.lastError = {
            message: "人工调整被拒绝",
            conflicts: result.conflicts
          };
          // Do not push history on illegal ops
          next.lastAction = "APPLY_MANUAL_MOVE_REJECTED";
          return next;
        }
        pushHistory(next);
        next.schedule = result.schedule;
        next.score = result.score;
        next.manualMode = true;
        next.validation = validateSchedule(input, next.schedule);
        next.explanation = "已应用人工调整（非自动最优）。";
        next.lastAction = "APPLY_MANUAL_MOVE";
        next.status = "ready";
        break;
      }

      case "UNDO": {
        if (next.past.length === 0) {
          next.lastError = { message: "没有可撤销的操作" };
          return next;
        }
        const current = snapshotBusiness(next);
        const prev = next.past.pop();
        next.future.push(current);
        restoreBusiness(next, prev);
        recomputeValidation(next);
        next.lastAction = "UNDO";
        next.status = "ready";
        break;
      }

      case "REDO": {
        if (next.future.length === 0) {
          next.lastError = { message: "没有可重做的操作" };
          return next;
        }
        const current = snapshotBusiness(next);
        const fut = next.future.pop();
        next.past.push(current);
        restoreBusiness(next, fut);
        recomputeValidation(next);
        next.lastAction = "REDO";
        next.status = "ready";
        break;
      }

      case "RESET": {
        pushHistory(next);
        next.offlineDevices = [];
        next.priorityOverrides = {};
        next.maintenanceShift = {};
        runSolve(next);
        next.status = "ready";
        next.lastAction = "RESET";
        break;
      }

      case "IMPORT_STATE": {
        const imported = action.payload;
        if (!imported || typeof imported !== "object") {
          next.lastError = { message: "导入数据无效" };
          return next;
        }
        // Validate structure
        const check = validateImportedPayload(imported, next.baseInput);
        if (!check.ok) {
          next.lastError = { message: check.message, details: check.details };
          return next;
        }
        pushHistory(next);
        next.offlineDevices = [...(imported.offlineDevices || [])].sort();
        next.priorityOverrides = { ...(imported.priorityOverrides || {}) };
        next.maintenanceShift = { ...(imported.maintenanceShift || {}) };
        next.schedule = deepClone(imported.schedule);
        next.manualMode = Boolean(imported.manualMode);
        next.explanation = imported.explanation || "已从文件导入状态";
        const input = recomputeValidation(next);
        if (!next.validation.valid) {
          // Keep imported schedule but surface conflicts — still a valid history step
          next.lastError = {
            message: "导入的排程存在冲突，请检查冲突面板",
            conflicts: next.validation.conflicts
          };
        }
        next.score = scoreSchedule(input, next.schedule);
        next.lastAction = "IMPORT_STATE";
        next.status = "ready";
        break;
      }

      case "SET_THEME": {
        // Theme does not enter business history
        next.theme = action.theme === "light" ? "light" : "dark";
        next.lastAction = "SET_THEME";
        break;
      }

      case "SET_TEST_SUMMARY": {
        next.testSummary = action.summary || null;
        break;
      }

      default: {
        next.lastError = { message: `未知 action: ${type}` };
      }
    }
  } catch (err) {
    next.lastError = {
      message: err?.message || String(err),
      stack: err?.stack
    };
    next.status = "error";
  }

  return next;
}

function validateImportedPayload(payload, baseInput) {
  if (!payload.schedule || !Array.isArray(payload.schedule.assignments)) {
    return { ok: false, message: "导入 JSON 缺少 schedule.assignments 数组" };
  }
  for (const a of payload.schedule.assignments) {
    if (!a || typeof a.taskId !== "string") {
      return { ok: false, message: "assignment 缺少合法 taskId" };
    }
    if (!Number.isFinite(a.start) || !Number.isFinite(a.end)) {
      return {
        ok: false,
        message: `任务 ${a.taskId} 的 start/end 必须为数字（分钟）`
      };
    }
    if (typeof a.operatorId !== "string") {
      return { ok: false, message: `任务 ${a.taskId} 缺少 operatorId` };
    }
  }
  if (payload.offlineDevices && !Array.isArray(payload.offlineDevices)) {
    return { ok: false, message: "offlineDevices 必须是数组" };
  }
  const taskIds = new Set(baseInput.tasks.map((t) => t.id));
  for (const a of payload.schedule.assignments) {
    if (!taskIds.has(a.taskId)) {
      return {
        ok: false,
        message: `导入排程引用了未知任务 ${a.taskId}`
      };
    }
  }
  return { ok: true };
}

/**
 * exportState(state) → plain serializable object
 */
export function exportState(state) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    offlineDevices: [...state.offlineDevices],
    priorityOverrides: { ...state.priorityOverrides },
    maintenanceShift: { ...state.maintenanceShift },
    schedule: deepClone(state.schedule),
    manualMode: state.manualMode,
    explanation: state.explanation,
    lastSolveMs: state.lastSolveMs
  };
}
