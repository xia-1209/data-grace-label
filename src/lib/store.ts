// Central localStorage-backed data store for the annotation platform.
// Keep deliberately framework-agnostic so any component can import.

export type Perspective = "production_tob" | "commercial_tob" | "commercial_toc";
export const PERSPECTIVES: Perspective[] = ["production_tob", "commercial_tob", "commercial_toc"];
export const PERSPECTIVE_LABEL: Record<Perspective, string> = {
  production_tob: "生产制造 ToB",
  commercial_tob: "商业销售 ToB",
  commercial_toc: "商业 ToC",
};

export type Role = "annotator" | "reviewer" | "admin";

export interface User {
  pid: string;
  username: string;
  password: string;
  role: Role;
  perspectives: Perspective[]; // editable perspectives
}

export interface FieldDef {
  key: string;
  label: string;
  type: "multi" | "single" | "text";
  options: string[];
  allowCustom?: boolean;
  required?: boolean;
  /** Linkage: when this field's dependency value changes, only show options mapped here */
  dependsOn?: string;
  optionMap?: Record<string, string[]>; // depValue -> allowed options
}

export interface CraftPartConfig {
  craftField: string; // field key
  partField: string; // field key
  rules: Record<string, string[]>; // craft option -> allowed parts
}

export interface Library {
  key: string;
  name: string;
  fields: FieldDef[];
  craftPart?: CraftPartConfig;
}

export interface StyleImage {
  url: string;
  angle?: string;
  filename?: string;
}

export interface DatasetStyle {
  id: string;          // internal id (uid)
  styleId: string;     // business style id, unique within dataset
  images: StyleImage[];
  preselect?: Partial<Record<Perspective, Record<string, string[]>>>;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  styles: DatasetStyle[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskAssignment {
  userPid: string;
  perspectives: Perspective[];
}

export interface Task {
  id: string;
  name: string;
  datasetId: string;
  libraryKey: string;
  annotators: TaskAssignment[];
  reviewers: string[]; // pids
  deadline: string;
  createdAt: number;
}

export type AnnoStatus = "not_started" | "drafted" | "submitted" | "approved" | "rejected";

export interface CraftPartGroup {
  craft: string;
  parts: string[];
}

export interface AnnoVersion {
  ts: number;
  status: AnnoStatus;
  by: string;
  reason?: string;
  data?: Record<string, string[] | string>;
  craftPartGroups?: CraftPartGroup[];
  customTags?: string[];
  note?: string; // reviewer internal note
}

export interface Annotation {
  id: string;
  taskId: string;
  styleId: string; // refers DatasetStyle.id
  perspective: Perspective;
  status: AnnoStatus;
  data: Record<string, string[] | string>;
  craftPartGroups?: CraftPartGroup[];
  customTags: string[];
  annotatorPid?: string;
  reviewerPid?: string;
  rejectReason?: string;
  reviewerNotes?: string[];
  history: AnnoVersion[];
  updatedAt: number;
}

export interface Rule {
  id: string;
  libraryKey: string;
  fieldKey: string;
  optionValue: string;
  definition: string;
  criteria: string;
  positiveImages: string[];
  exclusive: string[];
  dependency: string;
  notRecommended: boolean;
  notes: string;
  status: "draft" | "published";
  updatedAt: number;
}

export interface CustomTagRequest {
  id: string;
  libraryKey: string;
  fieldKey: string;
  value: string;
  byPid: string;
  status: "pending" | "approved" | "rejected";
  ts: number;
}

export interface LogEntry {
  id: string;
  ts: number;
  pid: string;
  action: string;
  detail?: string;
}

export interface DB {
  users: User[];
  libraries: Library[];
  datasets: Dataset[];
  tasks: Task[];
  annotations: Annotation[];
  rules: Rule[];
  tagRequests: CustomTagRequest[];
  logs: LogEntry[];
  ruleFeedback: Array<{ id: string; ruleId: string; byPid: string; text: string; handled: boolean; ts: number }>;
  ruleVersions: Array<{ id: string; ruleId: string; snapshot: Rule; ts: number }>;
}

const KEY = "garment_anno_db_v2";

export const uid = () => Math.random().toString(36).slice(2, 10);

export function loadDB(): DB {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const db = seedDB();
    saveDB(db);
    return db;
  }
  try {
    return JSON.parse(raw);
  } catch {
    const db = seedDB();
    saveDB(db);
    return db;
  }
}

export function saveDB(db: DB) {
  localStorage.setItem(KEY, JSON.stringify(db));
  window.dispatchEvent(new CustomEvent("db-updated"));
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  const db = seedDB();
  saveDB(db);
  return db;
}

export function log(action: string, pid: string, detail?: string) {
  const db = loadDB();
  db.logs.unshift({ id: uid(), ts: Date.now(), pid, action, detail });
  db.logs = db.logs.slice(0, 500);
  saveDB(db);
}

// ---------------- Seed ----------------
function seedDB(): DB {
  const styleLib: Library = {
    key: "style",
    name: "款式库",
    fields: [
      { key: "category", label: "品类", type: "multi", options: ["连衣裙", "上衣", "裤装", "半身裙"], allowCustom: true, required: true },
      { key: "silhouette", label: "廓形", type: "multi", options: ["A型", "H型", "X型", "O型"], allowCustom: true },
      { key: "neckline", label: "领型", type: "multi", options: ["圆领", "V领", "翻领", "高腰", "松紧腰"], allowCustom: true,
        dependsOn: "category", optionMap: {
          "连衣裙": ["圆领", "V领", "翻领"],
          "上衣": ["圆领", "V领", "翻领"],
          "裤装": ["高腰", "松紧腰"],
          "半身裙": ["高腰", "松紧腰"],
        } },
      { key: "style", label: "风格", type: "multi", options: ["简约", "复古", "运动", "通勤", "甜美"], allowCustom: true },
      { key: "craft", label: "工艺类型", type: "multi", options: ["压褶", "印花", "绣花", "洗水"], allowCustom: true },
      { key: "part", label: "部位", type: "multi", options: ["前中部位", "前襟", "袖口", "下摆", "领口"], allowCustom: true },
    ],
    craftPart: {
      craftField: "craft",
      partField: "part",
      rules: {
        压褶: ["前中部位", "前襟", "下摆"],
        印花: ["前中部位", "袖口", "下摆", "领口"],
        绣花: ["前中部位", "袖口", "领口"],
        洗水: ["前中部位", "前襟", "袖口", "下摆", "领口"],
      },
    },
  };
  const fabricLib: Library = {
    key: "fabric",
    name: "面料库",
    fields: [
      { key: "fabric_name", label: "面料名称", type: "text", options: [] },
      { key: "composition", label: "成分", type: "multi", options: ["棉", "麻", "丝", "毛", "化纤"], allowCustom: true },
      { key: "hand_feel", label: "手感", type: "single", options: ["柔软", "适中", "硬挺"] },
    ],
  };
  const commentLib: Library = {
    key: "comment",
    name: "客户评语库",
    fields: [
      { key: "sentiment", label: "情感倾向", type: "single", options: ["正面", "中性", "负面"] },
      { key: "topic", label: "主题", type: "multi", options: ["版型", "面料", "做工", "尺码", "物流"], allowCustom: true },
    ],
  };

  const images: DatasetImage[] = [
    { id: "img_1", filename: "dress_a.jpg", url: "https://images.unsplash.com/photo-1551232864-3f0890e580d9?w=800&q=80" },
    { id: "img_2", filename: "dress_b.jpg", url: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80" },
    { id: "img_3", filename: "top_c.jpg", url: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&q=80" },
  ];
  const dataset: Dataset = {
    id: "ds_demo",
    name: "演示数据集",
    description: "包含三张示例服装图片",
    images,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const users: User[] = [
    { pid: "P001", username: "admin", password: "admin", role: "admin", perspectives: PERSPECTIVES },
    { pid: "P002", username: "annotator1", password: "123", role: "annotator", perspectives: ["production_tob", "commercial_tob"] },
    { pid: "P003", username: "annotator2", password: "123", role: "annotator", perspectives: ["commercial_toc"] },
    { pid: "P004", username: "reviewer1", password: "123", role: "reviewer", perspectives: PERSPECTIVES },
  ];

  const task: Task = {
    id: "task_demo",
    name: "演示任务-款式库",
    datasetId: dataset.id,
    libraryKey: styleLib.key,
    annotators: [
      { userPid: "P002", perspectives: ["production_tob", "commercial_tob"] },
      { userPid: "P003", perspectives: ["commercial_toc"] },
    ],
    reviewers: ["P004"],
    deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    createdAt: Date.now(),
  };

  return {
    users,
    libraries: [styleLib, fabricLib, commentLib],
    datasets: [dataset],
    tasks: [task],
    annotations: [],
    rules: [
      {
        id: uid(),
        libraryKey: "style",
        fieldKey: "style",
        optionValue: "简约",
        definition: "线条简洁，无过多装饰",
        criteria: "整体颜色不超过2种，无明显logo或图案",
        positiveImages: [],
        exclusive: ["复古"],
        dependency: "",
        notRecommended: false,
        notes: "",
        status: "published",
        updatedAt: Date.now(),
      },
    ],
    tagRequests: [],
    logs: [],
    ruleFeedback: [],
    ruleVersions: [],
  };
}

export function getAnnotation(taskId: string, imageId: string, perspective: Perspective): Annotation | undefined {
  const db = loadDB();
  return db.annotations.find((a) => a.taskId === taskId && a.imageId === imageId && a.perspective === perspective);
}

export function upsertAnnotation(a: Annotation) {
  const db = loadDB();
  const idx = db.annotations.findIndex((x) => x.id === a.id);
  if (idx >= 0) db.annotations[idx] = a;
  else db.annotations.push(a);
  saveDB(db);
}
