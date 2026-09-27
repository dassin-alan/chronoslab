/**
 * Import/export helpers — no code execution, structural validation only.
 */

import { exportState } from "./state.js";

/**
 * importState(jsonText) → { ok, data?, error? }
 * Does not apply to app state; caller dispatches IMPORT_STATE.
 */
export function importState(jsonText) {
  if (typeof jsonText !== "string") {
    return { ok: false, error: "导入内容必须是字符串" };
  }
  const trimmed = jsonText.trim();
  if (!trimmed) {
    return { ok: false, error: "导入内容为空" };
  }

  // Reject obvious script payloads
  if (/^\s*<!DOCTYPE/i.test(trimmed) || /<script/i.test(trimmed)) {
    return { ok: false, error: "拒绝导入 HTML/脚本内容" };
  }

  let data;
  try {
    data = JSON.parse(trimmed);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败: ${err.message}`
    };
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "根节点必须是 JSON 对象" };
  }

  // Strip prototype pollution keys
  if (Object.prototype.hasOwnProperty.call(data, "__proto__")) {
    delete data.__proto__;
  }

  if (!data.schedule || typeof data.schedule !== "object") {
    return { ok: false, error: "缺少 schedule 字段" };
  }
  if (!Array.isArray(data.schedule.assignments)) {
    return { ok: false, error: "schedule.assignments 必须是数组" };
  }

  // Sanitize assignments to plain data
  const assignments = [];
  for (const raw of data.schedule.assignments) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "assignment 项非法" };
    }
    assignments.push({
      taskId: String(raw.taskId),
      start: Number(raw.start),
      end: Number(raw.end),
      deviceId: raw.deviceId != null ? String(raw.deviceId) : undefined,
      operatorId: String(raw.operatorId ?? "")
    });
  }

  const offlineDevices = Array.isArray(data.offlineDevices)
    ? data.offlineDevices.map((x) => String(x))
    : [];

  const priorityOverrides = {};
  if (data.priorityOverrides && typeof data.priorityOverrides === "object") {
    for (const [k, v] of Object.entries(data.priorityOverrides)) {
      const n = Number(v);
      if (Number.isFinite(n)) priorityOverrides[String(k)] = n;
    }
  }

  const maintenanceShift = {};
  if (data.maintenanceShift && typeof data.maintenanceShift === "object") {
    for (const [k, v] of Object.entries(data.maintenanceShift)) {
      const n = Number(v);
      if (Number.isFinite(n)) maintenanceShift[String(k)] = n;
    }
  }

  return {
    ok: true,
    data: {
      version: data.version ?? 1,
      offlineDevices,
      priorityOverrides,
      maintenanceShift,
      schedule: {
        assignments,
        unscheduledTaskIds: Array.isArray(data.schedule.unscheduledTaskIds)
          ? data.schedule.unscheduledTaskIds.map(String)
          : []
      },
      manualMode: Boolean(data.manualMode),
      explanation:
        typeof data.explanation === "string" ? data.explanation : ""
    }
  };
}

export function serializeState(state) {
  return JSON.stringify(exportState(state), null, 2);
}

export { exportState };
