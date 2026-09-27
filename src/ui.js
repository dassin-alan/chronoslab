/**
 * DOM rendering — textContent / createElement only (no untrusted innerHTML).
 */

import { minutesToTime, WORKDAY_START, WORKDAY_END } from "./normalize.js";
import { getEffectiveInput } from "./state.js";

const WORK_SPAN = WORKDAY_END - WORKDAY_START; // 600

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    } else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "disabled") node.disabled = Boolean(v);
    else if (k === "checked") node.checked = Boolean(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function pct(start, end) {
  const left = ((start - WORKDAY_START) / WORK_SPAN) * 100;
  const width = ((end - start) / WORK_SPAN) * 100;
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.max(0.5, width)}%`
  };
}

export function mountApp(root, getState, dispatch) {
  root.replaceChildren();
  const shell = el("div", { className: "app-shell", id: "app-shell" });
  root.appendChild(shell);

  function render() {
    const state = getState();
    document.documentElement.dataset.theme = state.theme || "dark";
    shell.replaceChildren();
    shell.classList.toggle("computing", state.status === "computing");

    try {
      shell.appendChild(renderHeader(state, dispatch));
      const main = el("main", { id: "main" });
      main.appendChild(renderMetrics(state));
      main.appendChild(renderControls(state, dispatch));
      const grid = el("div", { className: "grid-2" });
      grid.appendChild(renderDevices(state, dispatch));
      grid.appendChild(renderConflicts(state));
      main.appendChild(grid);
      main.appendChild(renderGantt(state, dispatch));
      main.appendChild(renderTasks(state, dispatch));
      main.appendChild(renderManual(state, dispatch));
      main.appendChild(renderImportExport(state, dispatch));
      main.appendChild(renderTests(state));
      shell.appendChild(main);
      shell.appendChild(
        el("footer", { className: "app-footer" }, [
          "ChronosLab · 本地离线运行 · 无外部依赖"
        ])
      );
      shell.appendChild(
        el("div", {
          className: "live-region",
          "aria-live": "polite",
          "aria-atomic": "true",
          id: "live-region",
          text: buildLiveMessage(state)
        })
      );
    } catch (err) {
      shell.appendChild(
        el("div", { className: "panel" }, [
          el("div", {
            className: "alert error",
            role: "alert",
            text: `界面渲染出错: ${err.message}`
          })
        ])
      );
      console.error(err);
    }
  }

  return { render };
}

function buildLiveMessage(state) {
  if (state.lastError?.message) return state.lastError.message;
  if (state.lastAction === "SOLVE") {
    return `排程完成，耗时 ${state.lastSolveMs} 毫秒`;
  }
  return `状态: ${state.lastAction || "就绪"}`;
}

function renderHeader(state, dispatch) {
  const statusTone =
    state.normalizeErrors?.length > 0
      ? "danger"
      : state.validation?.valid === false
        ? "warn"
        : "ok";
  const statusText =
    state.normalizeErrors?.length > 0
      ? "数据错误"
      : state.manualMode
        ? "人工调整"
        : state.validation?.valid
          ? "自动最优"
          : "存在冲突";

  return el("header", { className: "app-header" }, [
    el("div", { className: "brand" }, [
      el("h1", { text: "ChronosLab" }),
      el("div", {
        className: "sub",
        text: "多实验室科研设备智能排程与冲突恢复平台"
      })
    ]),
    el("div", { className: "header-meta" }, [
      el("span", { className: "badge", text: "工作日 08:00—18:00 · 15min 网格" }),
      el("span", {
        className: "badge",
        "data-tone": statusTone,
        text: `状态: ${statusText}`
      }),
      el("span", {
        className: "badge",
        "data-tone": "accent",
        text: `耗时: ${state.lastSolveMs ?? 0} ms`
      }),
      el(
        "button",
        {
          type: "button",
          "aria-label":
            state.theme === "light" ? "切换为深色主题" : "切换为浅色主题",
          onClick: () =>
            dispatch({
              type: "SET_THEME",
              theme: state.theme === "light" ? "dark" : "light"
            })
        },
        [state.theme === "light" ? "深色主题" : "浅色主题"]
      )
    ])
  ]);
}

function renderMetrics(state) {
  const s = state.score || {};
  const util = s.utilization != null ? `${(s.utilization * 100).toFixed(1)}%` : "—";
  const items = [
    ["已安排强制任务", s.mandatoryCount ?? "—"],
    ["已安排任务", s.scheduledCount ?? "—"],
    ["优先级总和", s.prioritySum ?? "—"],
    ["价值总和", s.valueSum ?? "—"],
    ["加权逾期(分)", s.weightedTardiness ?? "—"],
    ["Makespan", s.makespan != null ? minutesToTime(s.makespan) : "—"],
    ["未安排任务", s.unscheduledCount ?? "—"],
    ["设备利用率", util]
  ];
  return el("section", { className: "panel", "aria-label": "核心指标" }, [
    el("h2", { text: "核心指标" }),
    el(
      "div",
      { className: "metrics" },
      items.map(([label, value]) =>
        el("div", { className: "metric" }, [
          el("span", { className: "label", text: label }),
          el("span", { className: "value", text: String(value) })
        ])
      )
    )
  ]);
}

function renderControls(state, dispatch) {
  const children = [
    el("h2", { text: "全局操作" }),
    el("div", { className: "toolbar" }, [
      el(
        "button",
        {
          type: "button",
          className: "primary",
          onClick: () => dispatch({ type: "SOLVE" })
        },
        ["重新求解最优排程"]
      ),
      el(
        "button",
        {
          type: "button",
          disabled: state.past.length === 0,
          "aria-label": "撤销",
          onClick: () => dispatch({ type: "UNDO" })
        },
        ["撤销"]
      ),
      el(
        "button",
        {
          type: "button",
          disabled: state.future.length === 0,
          "aria-label": "重做",
          onClick: () => dispatch({ type: "REDO" })
        },
        ["重做"]
      ),
      el(
        "button",
        {
          type: "button",
          className: "ghost",
          onClick: () => dispatch({ type: "RESET" })
        },
        ["恢复初始最优"]
      )
    ])
  ];

  if (state.lastError?.message) {
    children.push(
      el("div", {
        className: "alert error",
        role: "alert",
        text: state.lastError.message
      })
    );
    if (state.lastError.conflicts?.length) {
      const detail = state.lastError.conflicts
        .slice(0, 5)
        .map((c) => c.message)
        .join("；");
      children.push(el("div", { className: "alert error", text: detail }));
    }
  }

  if (state.normalizeErrors?.length) {
    children.push(
      el("div", {
        className: "alert error",
        role: "alert",
        text: `规范化错误 ${state.normalizeErrors.length} 条（见控制台详情）`
      })
    );
  }

  if (state.explanation) {
    children.push(
      el("div", {
        className: "alert info",
        text: state.explanation
      })
    );
  }

  return el("section", { className: "panel", "aria-label": "全局操作" }, children);
}

function renderDevices(state, dispatch) {
  const input = getEffectiveInput(state);
  const cards = input.devices.map((d) => {
    const offline = state.offlineDevices.includes(d.id);
    const shift = state.maintenanceShift[d.id] || 0;
    const maintText =
      (d.maintenance || []).length === 0
        ? "无维护窗口"
        : d.maintenance
            .map((iv) => `${minutesToTime(iv.start)}–${minutesToTime(iv.end)}`)
            .join(", ");

    return el("article", { className: "device-card" }, [
      el("header", {}, [
        el("div", {}, [
          el("h3", { text: d.name }),
          el("div", { className: "id", text: d.id })
        ]),
        el("span", {
          className: "badge",
          "data-tone": offline ? "danger" : "ok",
          text: offline ? "离线" : "在线"
        })
      ]),
      el("div", {
        className: "id",
        text: `维护: ${maintText}${shift ? ` (偏移 ${shift}min)` : ""}`
      }),
      el("div", { className: "toolbar" }, [
        el(
          "button",
          {
            type: "button",
            "aria-label": `${offline ? "上线" : "离线"}设备 ${d.id}`,
            onClick: () =>
              dispatch({
                type: "SET_DEVICE_OFFLINE",
                deviceId: d.id,
                offline: !offline
              })
          },
          [offline ? "设为在线" : "设为离线"]
        ),
        el(
          "button",
          {
            type: "button",
            "aria-label": `维护窗口前移15分钟 ${d.id}`,
            onClick: () =>
              dispatch({
                type: "SHIFT_MAINTENANCE",
                deviceId: d.id,
                deltaMinutes: -15
              })
          },
          ["维护 −15m"]
        ),
        el(
          "button",
          {
            type: "button",
            "aria-label": `维护窗口后移15分钟 ${d.id}`,
            onClick: () =>
              dispatch({
                type: "SHIFT_MAINTENANCE",
                deviceId: d.id,
                deltaMinutes: 15
              })
          },
          ["维护 +15m"]
        ),
        el(
          "button",
          {
            type: "button",
            className: "ghost",
            "aria-label": `恢复默认维护窗口 ${d.id}`,
            onClick: () =>
              dispatch({
                type: "SHIFT_MAINTENANCE",
                deviceId: d.id,
                reset: true
              })
          },
          ["恢复维护"]
        )
      ])
    ]);
  });

  return el("section", { className: "panel", "aria-label": "设备控制" }, [
    el("h2", { text: "设备控制" }),
    el("div", { className: "device-list" }, cards)
  ]);
}

function renderConflicts(state) {
  const v = state.validation || { valid: true, conflicts: [] };
  const list =
    v.conflicts.length === 0
      ? [el("div", { className: "empty", text: "当前排程无冲突" })]
      : v.conflicts.map((c) =>
          el("div", { className: "conflict-item" }, [
            el("div", {
              className: "type",
              text: `${c.type}${c.resourceId ? ` · ${c.resourceId}` : ""}`
            }),
            el("div", { text: c.message }),
            el("div", {
              className: "id",
              text: `任务: ${(c.taskIds || []).join(", ") || "—"}`
            })
          ])
        );

  return el("section", { className: "panel", "aria-label": "冲突面板" }, [
    el("h2", { text: "冲突面板" }),
    el("div", { className: "toolbar", style: "margin-bottom:0.5rem" }, [
      el("span", {
        className: "badge",
        "data-tone": v.valid ? "ok" : "danger",
        text: v.valid ? "合法" : "非法"
      }),
      el("span", {
        className: "badge",
        text: `冲突数: ${v.conflicts.length}`
      })
    ]),
    el("div", { className: "conflict-list" }, list)
  ]);
}

function renderGantt(state) {
  const input = getEffectiveInput(state);
  const assignments = state.schedule?.assignments || [];
  const byDevice = new Map(input.devices.map((d) => [d.id, []]));
  const taskMap = new Map(input.tasks.map((t) => [t.id, t]));

  for (const a of assignments) {
    const list = byDevice.get(a.deviceId) || byDevice.get(taskMap.get(a.taskId)?.deviceId);
    if (list) list.push(a);
  }

  const ticks = [];
  for (let t = WORKDAY_START; t <= WORKDAY_END; t += 60) {
    const p = ((t - WORKDAY_START) / WORK_SPAN) * 100;
    ticks.push(
      el("span", {
        style: `left:${p}%`,
        text: minutesToTime(t)
      })
    );
  }

  const rows = input.devices.map((d) => {
    const track = el("div", {
      className: "gantt-track",
      role: "group",
      "aria-label": `设备 ${d.id} 时间轴`
    });

    for (const iv of d.maintenance || []) {
      const pos = pct(iv.start, iv.end);
      track.appendChild(
        el("div", {
          className: "gantt-maint",
          style: `left:${pos.left};width:${pos.width}`,
          title: `维护 ${minutesToTime(iv.start)}-${minutesToTime(iv.end)}`
        })
      );
    }

    for (const a of byDevice.get(d.id) || []) {
      const task = taskMap.get(a.taskId);
      const pos = pct(a.start, a.end);
      const title = [
        a.taskId,
        task?.name || "",
        `${minutesToTime(a.start)}–${minutesToTime(a.end)}`,
        `操作: ${a.operatorId}`,
        task?.mandatory ? "强制" : "可选"
      ].join(" | ");
      track.appendChild(
        el(
          "div",
          {
            className: "gantt-block",
            style: `left:${pos.left};width:${pos.width}`,
            tabindex: "0",
            role: "button",
            title,
            "aria-label": title,
            dataset: { mandatory: String(Boolean(task?.mandatory)) },
            text: a.taskId
          }
        )
      );
    }

    return el("div", { className: "gantt-row" }, [
      el("div", { className: "gantt-label", text: d.id }),
      track
    ]);
  });

  const unscheduled = (state.score?.unscheduledTaskIds ||
    state.schedule?.unscheduledTaskIds ||
    []).map((id) =>
    el("span", { className: "tag unscheduled", text: id })
  );

  return el("section", { className: "panel", "aria-label": "甘特图" }, [
    el("h2", { text: "甘特图（按设备）" }),
    el("div", { className: "gantt-scroll" }, [
      el("div", { className: "gantt" }, [
        el("div", { className: "gantt-axis" }, [
          el("div", { text: "设备" }),
          el("div", { className: "gantt-ticks" }, ticks)
        ]),
        ...rows
      ])
    ]),
    el("div", {}, [
      el("div", {
        className: "label",
        style: "font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem",
        text: "未安排任务"
      }),
      unscheduled.length
        ? el("div", { className: "unscheduled-list" }, unscheduled)
        : el("div", { className: "empty", text: "全部任务已安排" })
    ])
  ]);
}

function renderTasks(state, dispatch) {
  const input = getEffectiveInput(state);
  const assigned = new Map(
    (state.schedule?.assignments || []).map((a) => [a.taskId, a])
  );

  const head = el("tr", {}, [
    "ID",
    "名称",
    "设备",
    "人员",
    "时长",
    "最早",
    "截止",
    "优先级",
    "价值",
    "类型",
    "前置",
    "安排"
  ].map((t) => el("th", { text: t, scope: "col" })));

  const body = input.tasks.map((t) => {
    const a = assigned.get(t.id);
    const prioInput = el("input", {
      className: "prio-input",
      type: "number",
      min: "1",
      max: "10",
      value: String(t.priority),
      "aria-label": `任务 ${t.id} 优先级`,
      onChange: (e) => {
        dispatch({
          type: "SET_TASK_PRIORITY",
          taskId: t.id,
          priority: e.target.value
        });
      }
    });

    return el("tr", {}, [
      el("td", { text: t.id }),
      el("td", { text: t.name }),
      el("td", { text: t.deviceId }),
      el("td", { text: t.operators.join(", ") }),
      el("td", { text: String(t.duration) }),
      el("td", { text: minutesToTime(t.earliestStart) }),
      el("td", { text: minutesToTime(t.due) }),
      el("td", {}, [prioInput]),
      el("td", { text: String(t.value) }),
      el("td", {}, [
        el("span", {
          className: `tag ${t.mandatory ? "mandatory" : "optional"}`,
          text: t.mandatory ? "强制" : "可选"
        })
      ]),
      el("td", { text: t.dependsOn.join(", ") || "—" }),
      el("td", {}, [
        a
          ? el("span", {
              className: "tag scheduled",
              text: `${minutesToTime(a.start)} ${a.operatorId}`
            })
          : el("span", { className: "tag unscheduled", text: "未安排" })
      ])
    ]);
  });

  return el("section", { className: "panel", "aria-label": "任务列表" }, [
    el("h2", { text: "任务控制" }),
    el("div", { className: "table-wrap" }, [
      el("table", {}, [el("thead", {}, [head]), el("tbody", {}, body)])
    ])
  ]);
}

function renderManual(state, dispatch) {
  const input = getEffectiveInput(state);
  const scheduled = state.schedule?.assignments || [];
  const taskIds = scheduled.map((a) => a.taskId).sort();

  const taskSelect = el(
    "select",
    { id: "manual-task", "aria-label": "选择任务" },
    [
      el("option", { value: "", text: "选择已安排任务" }),
      ...taskIds.map((id) => el("option", { value: id, text: id }))
    ]
  );

  const startInput = el("input", {
    id: "manual-start",
    type: "text",
    placeholder: "HH:mm",
    value: "10:00",
    "aria-label": "新开始时间"
  });

  const opSelect = el("select", {
    id: "manual-op",
    "aria-label": "操作人员"
  });

  function refreshOps() {
    const tid = taskSelect.value;
    const task = input.tasks.find((t) => t.id === tid);
    opSelect.replaceChildren();
    if (!task) {
      opSelect.appendChild(el("option", { value: "", text: "—" }));
      return;
    }
    for (const op of task.operators) {
      opSelect.appendChild(el("option", { value: op, text: op }));
    }
    const cur = scheduled.find((a) => a.taskId === tid);
    if (cur) {
      startInput.value = minutesToTime(cur.start);
      opSelect.value = cur.operatorId;
    }
  }

  taskSelect.addEventListener("change", refreshOps);
  refreshOps();

  return el("section", { className: "panel", "aria-label": "人工调整" }, [
    el("h2", { text: "人工调整" }),
    el("div", { className: "form-row" }, [
      el("div", { className: "field" }, [
        el("label", { for: "manual-task", text: "任务" }),
        taskSelect
      ]),
      el("div", { className: "field" }, [
        el("label", { for: "manual-start", text: "新开始时间" }),
        startInput
      ]),
      el("div", { className: "field" }, [
        el("label", { for: "manual-op", text: "操作人员" }),
        opSelect
      ]),
      el(
        "button",
        {
          type: "button",
          className: "primary",
          onClick: () => {
            if (!taskSelect.value) return;
            dispatch({
              type: "APPLY_MANUAL_MOVE",
              taskId: taskSelect.value,
              newStart: startInput.value,
              operatorId: opSelect.value
            });
          }
        },
        ["提交调整"]
      )
    ]),
    el("p", {
      className: "empty",
      text: "合法调整会更新排程并可撤销；非法调整会被拒绝并显示原因。"
    })
  ]);
}

function renderImportExport(state, dispatch) {
  const fileInput = el("input", {
    type: "file",
    accept: "application/json,.json",
    id: "import-file",
    className: "sr-only",
    "aria-label": "选择导入 JSON 文件"
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { importState } = await import("./storage.js");
      const result = importState(text);
      if (!result.ok) {
        dispatch({
          type: "IMPORT_STATE",
          payload: null,
          _error: result.error
        });
        // dispatch a synthetic error via lastError by using invalid payload
        // better: handle in main
        window.__chronosImportError = result.error;
        dispatch({ type: "SET_THEME", theme: state.theme }); // no-op refresh? 
        // Use custom path in main — emit custom event
        window.dispatchEvent(
          new CustomEvent("chronos-import-error", { detail: result.error })
        );
        return;
      }
      dispatch({ type: "IMPORT_STATE", payload: result.data });
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("chronos-import-error", {
          detail: err.message
        })
      );
    } finally {
      fileInput.value = "";
    }
  });

  return el("section", { className: "panel", "aria-label": "导入导出" }, [
    el("h2", { text: "导入 / 导出" }),
    el("div", { className: "toolbar" }, [
      el(
        "button",
        {
          type: "button",
          onClick: () => {
            const { serializeState } = window.__chronosStorage;
            const blob = new Blob([serializeState(state)], {
              type: "application/json"
            });
            const url = URL.createObjectURL(blob);
            const a = el("a", {
              href: url,
              download: `chronoslab-state-${Date.now()}.json`
            });
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
          }
        },
        ["导出 JSON"]
      ),
      el(
        "button",
        {
          type: "button",
          onClick: () => fileInput.click()
        },
        ["导入 JSON"]
      ),
      fileInput
    ])
  ]);
}

function renderTests(state) {
  const t = state.testSummary;
  return el("section", { className: "panel", "aria-label": "测试状态" }, [
    el("h2", { text: "测试状态" }),
    t
      ? el("div", { className: "metrics" }, [
          el("div", { className: "metric" }, [
            el("span", { className: "label", text: "总数" }),
            el("span", { className: "value", text: String(t.total) })
          ]),
          el("div", { className: "metric" }, [
            el("span", { className: "label", text: "通过" }),
            el("span", { className: "value", text: String(t.passed) })
          ]),
          el("div", { className: "metric" }, [
            el("span", { className: "label", text: "失败" }),
            el("span", { className: "value", text: String(t.failed) })
          ]),
          el("div", { className: "metric" }, [
            el("span", { className: "label", text: "最近测试" }),
            el("span", {
              className: "value",
              style: "font-size:0.75rem",
              text: t.at || "—"
            })
          ])
        ])
      : el("div", {
          className: "empty",
          text: "请在终端运行 npm test。页面展示不能替代真实 Node 测试。"
        })
  ]);
}
