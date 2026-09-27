/**
 * Raw sample data — intentionally messy formats.
 * Normalization is handled exclusively by normalize.js.
 */

export const rawDevices = [
  {
    id: "SEM-1",
    name: "场发射扫描电子显微镜 ",
    available: ["08:00-18:00"],
    maintenance: [["12:00", "13:00"]]
  },
  {
    id: "XRD-1",
    name: "X射线衍射仪",
    available: "08:00-18:00",
    maintenance: [
      { start: "15:00", end: "15:30" }
    ]
  },
  {
    id: "RAMAN-1",
    name: "拉曼光谱仪",
    available: ["09:00", "18:00"],
    maintenance: []
  }
];

export const rawOperators = [
  {
    id: "Lin",
    name: "林晓",
    available: [
      ["08:00", "12:00"],
      ["13:00", "18:00"]
    ]
  },
  {
    id: "Chen",
    name: "陈默",
    available: "09:00-17:00"
  },
  {
    id: "Zhao",
    name: "赵宁",
    available: [
      { start: "10:00", end: "18:00" }
    ]
  }
];

export const rawTasks = [
  {
    id: "T01",
    name: "样品表面预扫描 ",
    device: "SEM-1",
    operators: "Lin",
    duration: 90,
    earliestStart: "08:00",
    due: "10:30",
    priority: "HIGH",
    value: 100,
    mandatory: true,
    dependsOn: null
  },
  {
    id: "T02",
    name: "晶相结构扫描",
    device: "XRD-1",
    operators: ["Chen"],
    duration: "01:30",
    earliestStart: "09:00",
    due: "13:00",
    priority: 7,
    value: 90,
    mandatory: true,
    dependsOn: "T01"
  },
  {
    id: "T03",
    name: "拉曼面扫描",
    device: "RAMAN-1",
    operators: "Zhao",
    duration: "75min",
    earliestStart: "10:00",
    due: "15:00",
    priority: "6",
    value: 80,
    mandatory: true,
    dependsOn: ["T01"]
  },
  {
    id: "T04",
    name: "高倍率形貌复核",
    device: "SEM-1",
    operators: ["Lin"],
    duration: "60 min",
    earliestStart: "13:00",
    due: "16:00",
    priority: "MEDIUM",
    value: 70,
    mandatory: false,
    dependsOn: "T02"
  },
  {
    id: "T05",
    name: "衍射峰复测",
    device: "XRD-1",
    operators: "Chen",
    duration: "0:45",
    earliestStart: "13:00",
    due: "16:30",
    priority: 5,
    value: 65,
    mandatory: false,
    dependsOn: ["T03"]
  },
  {
    id: "T06",
    name: "紧急污染排查",
    device: "SEM-1",
    operators: ["Zhao"],
    duration: 30,
    earliestStart: "10:00",
    due: "11:30",
    priority: 9,
    value: 95,
    mandatory: true,
    dependsOn: []
  },
  {
    id: "T07",
    name: "拉曼基线校准",
    device: "RAMAN-1",
    operators: "Chen",
    duration: "30min",
    earliestStart: "09:00",
    due: "10:00",
    priority: "LOW",
    value: 40,
    mandatory: false,
    dependsOn: null
  },
  {
    id: "T08",
    name: "最终结构一致性验证",
    device: "XRD-1",
    operators: "Lin",
    duration: 60,
    earliestStart: "14:00",
    due: "18:00",
    priority: 8,
    value: 75,
    mandatory: false,
    dependsOn: ["T04", "T05"]
  }
];
