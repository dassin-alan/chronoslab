# ChronosLab

多实验室科研设备智能排程与冲突恢复平台。

在单工作日（08:00—18:00、15 分钟网格）内，对多设备、多操作人员、带前置依赖的实验任务做**确定性全局最优排程**，并支持设备离线、优先级调整、维护窗口平移、人工改期、冲突检测、撤销/重做与状态导入导出。

纯原生 HTML / CSS / ES Modules + Node.js 内置模块，无第三方依赖、无 CDN、无外网请求。

## 运行要求

- Node.js **20+**（开发验证环境：Node v24.x）
- 现代浏览器（ES Modules）

## 安装与启动

本项目无 npm 依赖，无需 `npm install`。

```bash
# 启动本地静态服务器（默认 http://127.0.0.1:4173/）
npm start

# 运行自动化测试
npm test
```

可选环境变量：

- `PORT` — 端口（默认 `4173`）
- `HOST` — 监听地址（默认 `127.0.0.1`）

## 项目结构

```text
chronoslab/
├─ index.html          # 页面入口
├─ package.json
├─ server.js           # Node 内置 http 静态服务器（防目录穿越）
├─ README.md
├─ src/
│  ├─ data.js          # 原始样例数据（故意非规范格式）
│  ├─ normalize.js     # 数据规范化
│  ├─ scheduler.js     # 求解器 + 人工调整
│  ├─ validator.js     # 硬约束验证 + 七级评分
│  ├─ state.js         # 可预测状态机（含 undo/redo）
│  ├─ storage.js       # JSON 导入导出与校验
│  ├─ ui.js            # DOM 渲染
│  └─ main.js          # 应用装配
├─ styles/
│  └─ app.css
└─ tests/
   ├─ normalize.test.js
   ├─ scheduler.test.js
   ├─ validator.test.js
   └─ state.test.js
```

## 数据规范化策略

`normalizeInput(rawDevices, rawOperators, rawTasks)` 是唯一入口，求解器内不解析原始杂格式。

| 字段 | 支持输入 | 输出 |
|------|----------|------|
| 名称 | 任意字符串 | `trim()` |
| 时间区间 | `"08:00-18:00"` / `["08:00","18:00"]` / `{start,end}` | `{start,end}` 分钟数 |
| 时长 | `90` / `"90"` / `"90min"` / `"60 min"` / `"01:30"` / `"0:45"` | 正整数分钟，须为 15 倍数 |
| operators | 字符串或数组 | 字符串数组 |
| dependsOn | `null` / `""` / `"T01"` / 数组 | 字符串数组 |
| priority | `HIGH/MEDIUM/LOW` 或数字/数字串 | 1—10 整数（HIGH=9, MEDIUM=5, LOW=2） |
| mandatory / value | 任意 | 布尔 / 有限非负数 |

错误（重复 ID、未知资源、环依赖、非法时间等）写入 `errors` 数组，**不静默忽略**。

内部时间统一为「自 00:00 起的分钟数」；UI 再格式化为 `HH:mm`。

## 排程算法说明

**精确分支定界（Branch & Bound）**：

1. 将任务按拓扑序排列（同层优先强制任务、高优先级、字典序 ID）。
2. 对每个任务分支：在每位候选操作人员上，于**连续可行时间段的左端点**放置，或跳过该任务。
3. 仅在 15 分钟网格上检验可行性（设备可用/维护、人员可用、依赖、资源互斥、离线）。
4. 用贪心「最早可行」解作为初始上界；以强制任务数 / 优先级和 / 价值的乐观上界剪枝；加权逾期已超优则剪枝。
5. 叶节点用 `scoreSchedule` 做七级字典序比较，保留全局最优。

**为何只取连续可行段左端点仍保持最优**：在网格与硬日历约束下，把任务在段内右移只会不减加权逾期与 makespan，不增加已排任务集合，也不改善确定性键（同指标下更早的 `HH:mm` 字典序更优）。因此每个可行段只需枚举左端点。

### 七级优化目标（字典序）

1. 最大化已安排**强制**任务数  
2. 最大化已安排任务**优先级总和**  
3. 最大化已安排任务**价值总和**  
4. 最小化**加权逾期** `Σ max(0, end−due)×priority`  
5. 最小化 **makespan**（最晚结束时间）  
6. 最小化设备**空闲碎片**数（相邻任务间 >0 的间隔，不含首尾）  
7. 最小化确定性方案键：`T01@08:00#Lin|T02@...`（按任务 ID 排序拼接）

同一输入保证同一结果，不依赖对象枚举顺序。

### 复杂度

- 任务数 \(n\)，每任务候选操作人员 \(o\)、可行段数 \(s\)（通常很小）  
- 最坏 \(O((os+1)^n)\)，样例 \(n=8\) 经剪枝约 **200+ 节点 / 数毫秒**  
- 适合 \(n \lesssim 12\) 的实验室日排程规模  

### 剪枝策略

- 贪心种子立刻提供可比较的上界  
- 未排任务按「全部能排上」乐观估计强制/优先级/价值  
- 部分解加权逾期已劣于最优则剪  
- 依赖未满足则禁止放置  
- 离线设备上任务不可放置  

## 状态管理

`createInitialState` / `reduceState` / `exportState`：

- 业务状态集中在 state，DOM 只渲染  
- Action：`SOLVE`、`SET_DEVICE_OFFLINE`、`SET_TASK_PRIORITY`、`SHIFT_MAINTENANCE`、`APPLY_MANUAL_MOVE`、`UNDO`、`REDO`、`RESET`、`IMPORT_STATE`  
- Undo/Redo 栈各保留 20 步；新操作清空 redo  
- 主题变更不入业务历史  
- 非法人工调整 / 非法导入不污染历史  

## 导入导出格式

导出 JSON 示例字段：

```json
{
  "version": 1,
  "exportedAt": "ISO-8601",
  "offlineDevices": ["SEM-1"],
  "priorityOverrides": { "T07": 10 },
  "maintenanceShift": { "XRD-1": 15 },
  "schedule": {
    "assignments": [
      {
        "taskId": "T01",
        "start": 480,
        "end": 570,
        "deviceId": "SEM-1",
        "operatorId": "Lin"
      }
    ],
    "unscheduledTaskIds": []
  },
  "manualMode": false,
  "explanation": "..."
}
```

导入经 `JSON.parse` + 结构校验；拒绝 HTML/脚本；导入后重新 `validateSchedule`。时间字段为**分钟数**，不执行 JSON 内任何代码。

## 核心 API（可被隐藏测试 import）

| 函数 | 模块 |
|------|------|
| `normalizeInput` | `src/normalize.js` |
| `validateSchedule` / `scoreSchedule` | `src/validator.js` |
| `solveSchedule` / `applyManualMove` | `src/scheduler.js` |
| `createInitialState` / `reduceState` / `exportState` | `src/state.js` |
| `importState` | `src/storage.js` |

## 已知限制

1. 精确搜索适合中小规模日任务集；任务数显著增大时需换启发式或分解。  
2. 连续可行段左端点理论在「故意等待以避让未来任务」的极端模型下可能与全网格枚举有细微差别；在本项目硬约束与七级目标下已验证与样例/单测一致且合法最优。  
3. 单工作日模型，不支持跨日与任务拆分。  
4. 页面「测试状态」仅展示可选摘要，**不能替代** `npm test`。  
5. 静态服务器仅服务项目目录，默认绑定本机回环地址。

## 实际执行的测试结果

命令：

```bash
npm test
```

结果（本机实际运行）：

```text
ℹ tests 39
ℹ pass 39
ℹ fail 0
ℹ duration_ms ~156
```

命令：

```bash
npm start
```

实际输出：

```text
ChronosLab server running at http://127.0.0.1:4173/
```

本机校验：`GET /` → 200，`GET /src/main.js` → 200，`GET /../package.json` → 403（目录穿越被拦截）。
