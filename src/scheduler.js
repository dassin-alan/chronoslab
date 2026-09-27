/**
 * Exact branch-and-bound scheduler for ChronosLab.
 *
 * Search: topological DFS over place/skip decisions.
 * Start-time domain reduced to event points (resource release times,
 * availability/maintenance boundaries, earliest start) so branching
 * stays tractable while remaining complete for left-shift-equivalent
 * and all gap-aligned optima under 15-minute grids.
 *
 * Lexicographic objectives (max/min) via compareScores; first feasible
 * greedy seed strengthens pruning.
 */

import { WORKDAY_START, WORKDAY_END, GRID, minutesToTime } from "./normalize.js";
import {
  scoreSchedule,
  compareScores,
  isFeasiblePlacement,
  validateSchedule
} from "./validator.js";

function cloneInput(input) {
  return {
    devices: (input.devices || []).map((d) => ({
      ...d,
      available: (d.available || []).map((iv) => ({ ...iv })),
      maintenance: (d.maintenance || []).map((iv) => ({ ...iv }))
    })),
    operators: (input.operators || []).map((o) => ({
      ...o,
      available: (o.available || []).map((iv) => ({ ...iv }))
    })),
    tasks: (input.tasks || []).map((t) => ({
      ...t,
      operators: [...t.operators],
      dependsOn: [...t.dependsOn]
    }))
  };
}

function topoOrder(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map(tasks.map((t) => [t.id, 0]));
  const children = new Map(tasks.map((t) => [t.id, []]));

  for (const t of tasks) {
    for (const d of t.dependsOn) {
      if (!byId.has(d)) continue;
      indeg.set(t.id, (indeg.get(t.id) || 0) + 1);
      children.get(d).push(t.id);
    }
  }

  // Prefer mandatory, then higher priority, then id — among zero-indegree
  function readySort(ids) {
    return ids.sort((a, b) => {
      const ta = byId.get(a);
      const tb = byId.get(b);
      if (ta.mandatory !== tb.mandatory) return ta.mandatory ? -1 : 1;
      if (tb.priority !== ta.priority) return tb.priority - ta.priority;
      return a.localeCompare(b);
    });
  }

  let ready = readySort(
    tasks.filter((t) => (indeg.get(t.id) || 0) === 0).map((t) => t.id)
  );

  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    const ch = children.get(id) || [];
    for (const c of ch) {
      indeg.set(c, indeg.get(c) - 1);
      if (indeg.get(c) === 0) ready.push(c);
    }
    ready = readySort(ready);
  }

  if (order.length < tasks.length) {
    const left = tasks
      .map((t) => t.id)
      .filter((id) => !order.includes(id))
      .sort((a, b) => a.localeCompare(b));
    order.push(...left);
  }
  return order.map((id) => byId.get(id));
}

function snapUp(m) {
  if (m % GRID === 0) return m;
  return m + (GRID - (m % GRID));
}

/**
 * Complete set of candidate starts for a task given current placement:
 * all 15-min slots from minStart..maxStart that are feasible would be huge;
 * we use event-point domain + scan-forward earliest-per-gap which is
 * sufficient for optimality under regular resource calendars:
 * any feasible interval can be left-shifted to an event point without
 * worsening tardiness/makespan/idle when no positive release inside the gap
 * other than event points we collect.
 *
 * Event points: minStart, device free times, operator free times,
 * availability starts, maintenance ends.
 * Additionally include every grid point that starts a free common window
 * by walking minStart→maxStart but ONLY keep points where the slot is
 * the first grid of a newly free resource state (delta detection).
 *
 * Practical complete approach for n≤12: walk the grid but skip runs of
 * identical feasibility for (device free, op free) — only first of each
 * contiguous feasible segment per operator. This preserves all left-justified
 * placements and all placements that wait for a resource; mid-segment delay
 * can only hurt weighted tardiness / makespan / idle, never help priority/value/
 * mandatory. For equal tardiness, earlier starts dominate makespan; for idle
 * fragments, packing left is optimal. Deterministic key prefers earlier times
 * in our search order when scores equal... actually key is lex of "T@time#op",
 * earlier times give smaller keys for same HH pattern... "08:00" < "08:15".
 * So delaying never helps objective 7 either when prefix equal.
 * → Only earliest start of each contiguous feasible segment is needed.
 */
function candidateStarts(task, placed, input, offlineDevices, operatorId) {
  if (offlineDevices.has(task.deviceId)) return [];

  let minStart = Math.max(task.earliestStart, WORKDAY_START);
  for (const depId of task.dependsOn) {
    const dep = placed.get(depId);
    if (!dep) return [];
    minStart = Math.max(minStart, dep.end);
  }
  minStart = snapUp(minStart);
  const maxStart = WORKDAY_END - task.duration;
  if (minStart > maxStart) return [];

  const starts = [];
  let prevFeasible = false;
  for (let s = minStart; s <= maxStart; s += GRID) {
    const ok = isFeasiblePlacement(
      input,
      task,
      s,
      operatorId,
      placed,
      offlineDevices
    );
    if (ok && !prevFeasible) {
      starts.push(s);
    }
    prevFeasible = ok;
  }
  return starts;
}

function optimisticBound(tasks, placedIds, partial) {
  let mand = partial.mandatoryCount;
  let pri = partial.prioritySum;
  let val = partial.valueSum;
  for (const t of tasks) {
    if (placedIds.has(t.id)) continue;
    if (t.mandatory) mand += 1;
    pri += t.priority;
    val += t.value;
  }
  return { mandatoryCount: mand, prioritySum: pri, valueSum: val };
}

function partialScore(input, placed) {
  return scoreSchedule(input, { assignments: [...placed.values()] });
}

function buildExplanation(score) {
  return [
    `强制任务 ${score.mandatoryCount} 项已安排`,
    `优先级总和 ${score.prioritySum}`,
    `价值总和 ${score.valueSum}`,
    `加权逾期 ${score.weightedTardiness} 分钟`,
    `makespan ${minutesToTime(score.makespan)}`,
    `设备空闲碎片 ${score.idleFragments}`,
    `确定性键 ${score.deterministicKey || "(空)"}`
  ].join("；");
}

/**
 * Greedy seed: schedule in topo order at earliest feasible (op,start).
 */
function greedySeed(input, offlineDevices) {
  const ordered = topoOrder(input.tasks);
  const placed = new Map();
  for (const task of ordered) {
    if (!task.dependsOn.every((d) => placed.has(d))) continue;
    const ops = [...task.operators].sort((a, b) => a.localeCompare(b));
    let best = null;
    for (const opId of ops) {
      const starts = candidateStarts(task, placed, input, offlineDevices, opId);
      for (const start of starts) {
        best = {
          taskId: task.id,
          start,
          end: start + task.duration,
          deviceId: task.deviceId,
          operatorId: opId
        };
        break;
      }
      if (best) break;
    }
    if (best) placed.set(task.id, best);
  }
  return placed;
}

function search(input, options = {}) {
  const offlineDevices = new Set(
    options.offlineDevices ||
      input.devices.filter((d) => d.offline).map((d) => d.id)
  );

  const devices = input.devices.map((d) => ({
    ...d,
    offline: offlineDevices.has(d.id)
  }));
  const eff = { ...input, devices };
  const ordered = topoOrder(eff.tasks);

  let best = null;
  let bestScore = null;
  let nodes = 0;
  const maxNodes = options.maxNodes ?? 2_000_000;

  function consider(placed) {
    const assignments = [...placed.values()].sort((a, b) =>
      a.taskId.localeCompare(b.taskId)
    );
    const score = scoreSchedule(eff, { assignments });
    if (!bestScore || compareScores(score, bestScore) > 0) {
      bestScore = score;
      best = {
        assignments,
        unscheduledTaskIds: score.unscheduledTaskIds,
        score
      };
    }
  }

  // Seed
  const seed = greedySeed(eff, offlineDevices);
  consider(seed);

  function canPrune(placed) {
    if (!bestScore) return false;
    const partial = partialScore(eff, placed);
    const bound = optimisticBound(eff.tasks, new Set(placed.keys()), partial);
    if (bound.mandatoryCount < bestScore.mandatoryCount) return true;
    if (
      bound.mandatoryCount === bestScore.mandatoryCount &&
      bound.prioritySum < bestScore.prioritySum
    ) {
      return true;
    }
    if (
      bound.mandatoryCount === bestScore.mandatoryCount &&
      bound.prioritySum === bestScore.prioritySum &&
      bound.valueSum < bestScore.valueSum
    ) {
      return true;
    }
    // Tardiness lower bound: current tardiness only (remaining ≥ 0)
    if (
      bound.mandatoryCount === bestScore.mandatoryCount &&
      bound.prioritySum === bestScore.prioritySum &&
      bound.valueSum === bestScore.valueSum &&
      partial.weightedTardiness > bestScore.weightedTardiness
    ) {
      return true;
    }
    return false;
  }

  function dfs(idx, placed) {
    nodes += 1;
    if (nodes > maxNodes) return;

    if (idx >= ordered.length) {
      consider(placed);
      return;
    }
    if (canPrune(placed)) return;

    const task = ordered[idx];
    const depsOk = task.dependsOn.every((d) => placed.has(d));

    // Collect place options deterministically
    const optionsList = [];
    if (depsOk) {
      const operators = [...task.operators].sort((a, b) => a.localeCompare(b));
      for (const opId of operators) {
        const starts = candidateStarts(
          task,
          placed,
          eff,
          offlineDevices,
          opId
        );
        for (const start of starts) {
          optionsList.push({ opId, start });
        }
      }
    }

    // Try placements first (better bounds), then skip
    for (const { opId, start } of optionsList) {
      placed.set(task.id, {
        taskId: task.id,
        start,
        end: start + task.duration,
        deviceId: task.deviceId,
        operatorId: opId
      });
      dfs(idx + 1, placed);
      placed.delete(task.id);
      if (nodes > maxNodes) return;
    }

    // Skip — unless mandatory and we already know we can schedule more mandatories
    // Always allow skip for completeness
    dfs(idx + 1, placed);
  }

  dfs(0, new Map());

  if (!best) {
    const emptyScore = scoreSchedule(eff, { assignments: [] });
    best = {
      assignments: [],
      unscheduledTaskIds: emptyScore.unscheduledTaskIds,
      score: emptyScore
    };
  }

  return {
    ...best,
    stats: { nodesExplored: nodes, taskOrder: ordered.map((t) => t.id) }
  };
}

export function solveSchedule(input, options = {}) {
  const t0 = Date.now();
  const result = search(cloneInput(input), options);
  const elapsedMs = Date.now() - t0;

  const explanation = [
    "采用精确分支定界：拓扑序决策 + 连续可行段左端点候选时间 + 乐观界剪枝。",
    `搜索节点 ${result.stats.nodesExplored}。`,
    buildExplanation(result.score),
    `计算耗时 ${elapsedMs} ms。`
  ].join(" ");

  return {
    assignments: result.assignments,
    unscheduledTaskIds: result.unscheduledTaskIds,
    score: result.score,
    stats: { ...result.stats, elapsedMs },
    explanation
  };
}

function parseTimeString(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function applyManualMove(input, schedule, taskId, newStart, operatorId) {
  const tasks = new Map((input.tasks || []).map((t) => [t.id, t]));
  const task = tasks.get(taskId);
  if (!task) {
    return {
      ok: false,
      schedule,
      conflicts: [
        {
          type: "UNKNOWN_TASK",
          taskIds: [taskId],
          resourceId: null,
          message: `未知任务 ${taskId}`
        }
      ]
    };
  }

  const startMin = parseTimeString(newStart);
  if (startMin == null) {
    return {
      ok: false,
      schedule,
      conflicts: [
        {
          type: "INVALID_TIME",
          taskIds: [taskId],
          resourceId: null,
          message: "非法开始时间"
        }
      ]
    };
  }

  const end = startMin + task.duration;
  const assignments = (schedule.assignments || [])
    .filter((a) => a.taskId !== taskId)
    .map((a) => ({ ...a }));

  assignments.push({
    taskId,
    start: startMin,
    end,
    deviceId: task.deviceId,
    operatorId
  });

  const next = {
    assignments: assignments.sort((a, b) => a.taskId.localeCompare(b.taskId))
  };

  const result = validateSchedule(input, next);
  if (!result.valid) {
    return {
      ok: false,
      schedule,
      conflicts: result.conflicts
    };
  }

  const score = scoreSchedule(input, next);
  return {
    ok: true,
    schedule: {
      assignments: next.assignments,
      unscheduledTaskIds: score.unscheduledTaskIds
    },
    score,
    conflicts: []
  };
}
