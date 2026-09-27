/**
 * Application entry — wires state, UI, import/export.
 */

import { createInitialState, reduceState, exportState } from "./state.js";
import { serializeState, importState } from "./storage.js";
import { mountApp } from "./ui.js";

// Expose storage helpers for export button without circular imports
window.__chronosStorage = { serializeState, exportState, importState };

let state;
let ui;

function getState() {
  return state;
}

function dispatch(action) {
  // Intercept bogus IMPORT with null from UI race — real import goes through payload
  if (action?.type === "IMPORT_STATE" && action.payload == null) {
    state = {
      ...state,
      lastError: { message: action._error || "导入失败" }
    };
    ui.render();
    return;
  }

  try {
    state = reduceState(state, action);
  } catch (err) {
    console.error(err);
    state = {
      ...state,
      lastError: { message: err.message || String(err) },
      status: "error"
    };
  }
  ui.render();
}

function boot() {
  const root = document.getElementById("app");
  if (!root) {
    document.body.textContent = "缺少 #app 根节点";
    return;
  }

  try {
    state = createInitialState();
  } catch (err) {
    root.textContent = `初始化失败: ${err.message}`;
    console.error(err);
    return;
  }

  // Optional: show last known test summary from localStorage (display only)
  try {
    const raw = localStorage.getItem("chronoslab-test-summary");
    if (raw) {
      const summary = JSON.parse(raw);
      state = reduceState(state, { type: "SET_TEST_SUMMARY", summary });
    }
  } catch {
    /* ignore */
  }

  ui = mountApp(root, getState, dispatch);
  ui.render();

  window.addEventListener("chronos-import-error", (e) => {
    state = {
      ...state,
      lastError: { message: `导入失败: ${e.detail}` }
    };
    ui.render();
  });

  // Keyboard: Ctrl+Z / Ctrl+Y
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      dispatch({ type: "UNDO" });
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === "y" ||
        (e.key.toLowerCase() === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      dispatch({ type: "REDO" });
    }
  });
}

boot();
