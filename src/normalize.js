/**
 * Data normalization — all messy input formats become structured minutes-based data.
 * Solver and validator must not re-parse raw formats.
 */

export const WORKDAY_START = 8 * 60; // 480
export const WORKDAY_END = 18 * 60; // 1080
export const GRID = 15;

const PRIORITY_MAP = {
  HIGH: 9,
  MEDIUM: 5,
  LOW: 2
};

/**
 * Parse "HH:mm" to minutes from 00:00. Returns null if invalid.
 */
export function parseTimeToMinutes(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Format minutes from 00:00 to "HH:mm".
 */
export function minutesToTime(minutes) {
  if (!Number.isFinite(minutes)) return "--:--";
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Normalize a single time interval from various formats.
 * Supports: "08:00-18:00" | ["08:00","18:00"] | {start,end}
 */
export function normalizeInterval(raw) {
  if (raw == null) {
    return { ok: false, error: "时间区间为空" };
  }

  let startStr;
  let endStr;

  if (typeof raw === "string") {
    const parts = raw.split("-").map((s) => s.trim());
    if (parts.length !== 2) {
      return { ok: false, error: `非法时间区间字符串: ${raw}` };
    }
    startStr = parts[0];
    endStr = parts[1];
  } else if (Array.isArray(raw)) {
    if (raw.length !== 2) {
      return { ok: false, error: `非法时间区间数组长度: ${JSON.stringify(raw)}` };
    }
    startStr = raw[0];
    endStr = raw[1];
  } else if (typeof raw === "object") {
    startStr = raw.start;
    endStr = raw.end;
  } else {
    return { ok: false, error: `不支持的时间区间类型: ${typeof raw}` };
  }

  const start = parseTimeToMinutes(String(startStr));
  const end = parseTimeToMinutes(String(endStr));
  if (start == null || end == null) {
    return { ok: false, error: `非法时间: ${startStr}-${endStr}` };
  }
  if (end <= start) {
    return { ok: false, error: `结束时间早于或等于开始时间: ${startStr}-${endStr}` };
  }
  return { ok: true, interval: { start, end } };
}

/**
 * Normalize a list of intervals (array of any supported format, or single string).
 */
export function normalizeIntervalList(raw, label) {
  const errors = [];
  const intervals = [];

  if (raw == null) {
    return { intervals, errors: [`${label}: 可用时间缺失`] };
  }

  const list = Array.isArray(raw) ? raw : [raw];

  // Detect pair-array form: ["09:00", "18:00"] as single interval
  if (
    Array.isArray(raw) &&
    raw.length === 2 &&
    typeof raw[0] === "string" &&
    typeof raw[1] === "string" &&
    !String(raw[0]).includes("-") &&
    parseTimeToMinutes(raw[0]) != null &&
    parseTimeToMinutes(raw[1]) != null
  ) {
    const r = normalizeInterval(raw);
    if (!r.ok) errors.push(`${label}: ${r.error}`);
    else intervals.push(r.interval);
    return { intervals, errors };
  }

  for (const item of list) {
    const r = normalizeInterval(item);
    if (!r.ok) errors.push(`${label}: ${r.error}`);
    else intervals.push(r.interval);
  }
  return { intervals, errors };
}

/**
 * Duration formats: 90 | "90" | "90min" | "60 min" | "01:30" | "0:45"
 */
export function normalizeDuration(raw) {
  if (raw == null || raw === "") {
    return { ok: false, error: "时长为空" };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      return { ok: false, error: `非法时长数值: ${raw}` };
    }
    if (raw % GRID !== 0) {
      return { ok: false, error: `时长必须是${GRID}的倍数: ${raw}` };
    }
    return { ok: true, duration: raw };
  }

  const s = String(raw).trim();

  // HH:MM or H:MM as duration
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const mins = Number(hm[1]) * 60 + Number(hm[2]);
    if (mins <= 0) return { ok: false, error: `时长必须大于0: ${s}` };
    if (mins % GRID !== 0) {
      return { ok: false, error: `时长必须是${GRID}的倍数: ${s}` };
    }
    return { ok: true, duration: mins };
  }

  // 90min / 60 min / 90
  const num = s.match(/^(\d+)\s*(min|mins|m|分钟)?$/i);
  if (num) {
    const mins = Number(num[1]);
    if (mins <= 0) return { ok: false, error: `时长必须大于0: ${s}` };
    if (mins % GRID !== 0) {
      return { ok: false, error: `时长必须是${GRID}的倍数: ${s}` };
    }
    return { ok: true, duration: mins };
  }

  return { ok: false, error: `无法解析时长: ${s}` };
}

export function normalizePriority(raw) {
  if (raw == null || raw === "") {
    return { ok: false, error: "优先级为空" };
  }
  if (typeof raw === "string") {
    const upper = raw.trim().toUpperCase();
    if (Object.prototype.hasOwnProperty.call(PRIORITY_MAP, upper)) {
      return { ok: true, priority: PRIORITY_MAP[upper] };
    }
    const n = Number(upper);
    if (Number.isInteger(n)) {
      return { ok: true, priority: clampPriority(n) };
    }
    return { ok: false, error: `无法解析优先级: ${raw}` };
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { ok: true, priority: clampPriority(Math.round(raw)) };
  }
  return { ok: false, error: `非法优先级类型: ${typeof raw}` };
}

function clampPriority(n) {
  return Math.min(10, Math.max(1, n));
}

export function normalizeDependsOn(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return [String(raw).trim()].filter(Boolean);
}

export function normalizeOperators(raw) {
  if (raw == null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  return [String(raw).trim()].filter(Boolean);
}

function detectCycles(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(id, path) {
    if (visiting.has(id)) {
      const idx = path.indexOf(id);
      cycles.push([...path.slice(idx), id]);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    path.push(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependsOn) {
        if (dep === id) {
          cycles.push([id, id]);
        } else if (byId.has(dep)) {
          dfs(dep, path);
        }
      }
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const t of tasks) {
    dfs(t.id, []);
  }
  return cycles;
}

/**
 * normalizeInput(rawDevices, rawOperators, rawTasks)
 */
export function normalizeInput(rawDevices, rawOperators, rawTasks) {
  const errors = [];
  const devices = [];
  const operators = [];
  const tasks = [];

  if (!Array.isArray(rawDevices)) {
    errors.push({ code: "INVALID_DEVICES", message: "rawDevices 必须是数组" });
  }
  if (!Array.isArray(rawOperators)) {
    errors.push({ code: "INVALID_OPERATORS", message: "rawOperators 必须是数组" });
  }
  if (!Array.isArray(rawTasks)) {
    errors.push({ code: "INVALID_TASKS", message: "rawTasks 必须是数组" });
  }

  if (errors.length) {
    return { devices: [], operators: [], tasks: [], errors };
  }

  const deviceIds = new Set();
  for (const d of rawDevices) {
    if (!d || d.id == null || String(d.id).trim() === "") {
      errors.push({ code: "DEVICE_ID", message: "设备缺少 id" });
      continue;
    }
    const id = String(d.id).trim();
    if (deviceIds.has(id)) {
      errors.push({ code: "DUPLICATE_ID", message: `重复的设备 ID: ${id}` });
      continue;
    }
    deviceIds.add(id);

    const avail = normalizeIntervalList(d.available, `设备 ${id} available`);
    errors.push(
      ...avail.errors.map((m) => ({ code: "DEVICE_AVAILABLE", message: m }))
    );

    let maintenance = [];
    if (d.maintenance != null) {
      if (!Array.isArray(d.maintenance)) {
        errors.push({
          code: "DEVICE_MAINTENANCE",
          message: `设备 ${id}: maintenance 必须是数组`
        });
      } else {
        for (const item of d.maintenance) {
          const r = normalizeInterval(item);
          if (!r.ok) {
            errors.push({
              code: "DEVICE_MAINTENANCE",
              message: `设备 ${id}: ${r.error}`
            });
          } else {
            maintenance.push(r.interval);
          }
        }
      }
    }

    devices.push({
      id,
      name: String(d.name ?? id).trim(),
      available: avail.intervals,
      maintenance,
      offline: false
    });
  }

  const operatorIds = new Set();
  for (const o of rawOperators) {
    if (!o || o.id == null || String(o.id).trim() === "") {
      errors.push({ code: "OPERATOR_ID", message: "操作人员缺少 id" });
      continue;
    }
    const id = String(o.id).trim();
    if (operatorIds.has(id)) {
      errors.push({ code: "DUPLICATE_ID", message: `重复的操作人员 ID: ${id}` });
      continue;
    }
    operatorIds.add(id);

    const avail = normalizeIntervalList(o.available, `操作人员 ${id} available`);
    errors.push(
      ...avail.errors.map((m) => ({ code: "OPERATOR_AVAILABLE", message: m }))
    );

    operators.push({
      id,
      name: String(o.name ?? id).trim(),
      available: avail.intervals
    });
  }

  const taskIds = new Set();
  for (const t of rawTasks) {
    if (!t || t.id == null || String(t.id).trim() === "") {
      errors.push({ code: "TASK_ID", message: "任务缺少 id" });
      continue;
    }
    const id = String(t.id).trim();
    if (taskIds.has(id)) {
      errors.push({ code: "DUPLICATE_ID", message: `重复的任务 ID: ${id}` });
      continue;
    }
    taskIds.add(id);

    const deviceId = t.device != null ? String(t.device).trim() : "";
    if (!deviceId || !deviceIds.has(deviceId)) {
      errors.push({
        code: "UNKNOWN_DEVICE",
        message: `任务 ${id}: 未知设备 ${deviceId || "(空)"}`
      });
    }

    const ops = normalizeOperators(t.operators);
    if (ops.length === 0) {
      errors.push({
        code: "NO_OPERATORS",
        message: `任务 ${id}: 没有任何操作人员`
      });
    }
    for (const op of ops) {
      if (!operatorIds.has(op)) {
        errors.push({
          code: "UNKNOWN_OPERATOR",
          message: `任务 ${id}: 未知操作人员 ${op}`
        });
      }
    }

    const dur = normalizeDuration(t.duration);
    if (!dur.ok) {
      errors.push({
        code: "INVALID_DURATION",
        message: `任务 ${id}: ${dur.error}`
      });
    }

    const earliest = parseTimeToMinutes(String(t.earliestStart ?? ""));
    if (earliest == null) {
      errors.push({
        code: "INVALID_TIME",
        message: `任务 ${id}: 非法 earliestStart ${t.earliestStart}`
      });
    }

    const due = parseTimeToMinutes(String(t.due ?? ""));
    if (due == null) {
      errors.push({
        code: "INVALID_TIME",
        message: `任务 ${id}: 非法 due ${t.due}`
      });
    }

    const pri = normalizePriority(t.priority);
    if (!pri.ok) {
      errors.push({
        code: "INVALID_PRIORITY",
        message: `任务 ${id}: ${pri.error}`
      });
    }

    let value = Number(t.value);
    if (!Number.isFinite(value) || value < 0) {
      errors.push({
        code: "INVALID_VALUE",
        message: `任务 ${id}: value 必须是有限非负数`
      });
      value = 0;
    }

    const dependsOn = normalizeDependsOn(t.dependsOn);
    if (dependsOn.includes(id)) {
      errors.push({
        code: "SELF_DEPENDENCY",
        message: `任务 ${id}: 自依赖`
      });
    }

    const mandatory = Boolean(t.mandatory);

    tasks.push({
      id,
      name: String(t.name ?? id).trim(),
      deviceId,
      operators: ops,
      duration: dur.ok ? dur.duration : 0,
      earliestStart: earliest ?? 0,
      due: due ?? 0,
      priority: pri.ok ? pri.priority : 1,
      value,
      mandatory,
      dependsOn
    });
  }

  // Missing dependency references
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!taskIds.has(dep)) {
        errors.push({
          code: "MISSING_DEPENDENCY",
          message: `任务 ${t.id}: 不存在的依赖任务 ${dep}`
        });
      }
    }
  }

  // Cycle detection
  const cycles = detectCycles(tasks);
  if (cycles.length) {
    const seen = new Set();
    for (const c of cycles) {
      const key = c.join("→");
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push({
        code: "CYCLE_DEPENDENCY",
        message: `循环依赖: ${key}`
      });
    }
  }

  // Sort for determinism
  devices.sort((a, b) => a.id.localeCompare(b.id));
  operators.sort((a, b) => a.id.localeCompare(b.id));
  tasks.sort((a, b) => a.id.localeCompare(b.id));

  return { devices, operators, tasks, errors };
}
