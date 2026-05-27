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
export const ALL_ROLES: Role[] = ["annotator", "reviewer", "admin"];

export interface User {
  pid: string;
  username: string;
  password: string;
  roles: Role[]; // a user can have multiple roles
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
  craftField: string;
  partField: string;
  rules: Record<string, string[]>;
}

export interface LibraryRelation {
  relationId: string;
  fromField: string;
  toField: string;
  mapping: Record<string, string[]>;
}

export interface Library {
  key: string;
  name: string;
  fields: FieldDef[];
  craftPart?: CraftPartConfig; // legacy, auto-migrated
  relations?: LibraryRelation[];
  guidelines?: string;
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

export interface RelationGroup {
  relationId: string;
  from: string;
  to: string[];
}

export interface AnnoVersion {
  ts: number;
  status: AnnoStatus;
  by: string;
  reason?: string;
  data?: Record<string, string[] | string>;
  craftPartGroups?: CraftPartGroup[];
  relationGroups?: RelationGroup[];
  customTags?: string[];
  note?: string;
}

export interface Annotation {
  id: string;
  taskId: string;
  styleId: string;
  perspective: Perspective;
  status: AnnoStatus;
  data: Record<string, string[] | string>;
  craftPartGroups?: CraftPartGroup[];
  relationGroups?: RelationGroup[];
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

const KEY = "garment_anno_db_v3_multilib";

export const uid = () => Math.random().toString(36).slice(2, 10);

export function loadDB(): DB {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const db = seedDB();
    saveDB(db);
    return db;
  }
  try {
    const db = JSON.parse(raw) as DB;
    let changed = false;
    // Migrate legacy users: { role, perspectives } -> { roles }
    db.users = (db.users || []).map((u: any) => {
      if (!u.roles || !Array.isArray(u.roles)) {
        changed = true;
        const roles: Role[] = u.role ? [u.role as Role] : ["annotator"];
        const { role, perspectives, ...rest } = u;
        return { ...rest, roles };
      }
      return u;
    });
    // Backfill missing demo multi-role users
    const demoUsers: User[] = [
      { pid: "P005", username: "lead", password: "123", roles: ["annotator", "reviewer"] },
      { pid: "P006", username: "superadmin", password: "123", roles: ["admin", "reviewer", "annotator"] },
    ];
    demoUsers.forEach((du) => {
      if (!db.users.find((u) => u.username === du.username)) {
        db.users.push(du);
        changed = true;
      }
    });
    // Migrate libraries: convert legacy craftPart to relations[]; ensure guidelines field
    db.libraries = (db.libraries || []).map((l: any) => {
      if (!Array.isArray(l.relations)) {
        l.relations = [];
        if (l.craftPart) {
          l.relations.push({
            relationId: "rel_craft_part",
            fromField: l.craftPart.craftField,
            toField: l.craftPart.partField,
            mapping: { ...l.craftPart.rules },
          });
        }
        changed = true;
      }
      if (typeof l.guidelines !== "string") { l.guidelines = ""; changed = true; }
      return l;
    });
    // Migrate annotations: craftPartGroups -> relationGroups (using rel_craft_part)
    db.annotations = (db.annotations || []).map((a: any) => {
      if (!Array.isArray(a.relationGroups)) {
        a.relationGroups = Array.isArray(a.craftPartGroups)
          ? a.craftPartGroups.map((g: any) => ({ relationId: "rel_craft_part", from: g.craft, to: g.parts }))
          : [];
        changed = true;
      }
      return a;
    });
    if (changed) saveDB(db);
    return db;
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
      { key: "fabric_name", label: "面料名称", type: "text", options: [], required: true },
      { key: "composition", label: "成分", type: "multi", options: ["棉", "麻", "丝", "毛", "化纤", "涤纶"], allowCustom: true },
      { key: "weight", label: "克重", type: "single", options: ["轻薄(<150g)", "中等(150-250g)", "厚重(>250g)"] },
      { key: "style", label: "风格", type: "multi", options: ["简约", "复古", "运动", "通勤", "甜美"], allowCustom: true },
      { key: "hand_feel", label: "手感", type: "single", options: ["柔软", "适中", "硬挺"] },
    ],
  };
  const partLib: Library = {
    key: "part",
    name: "部件库",
    fields: [
      { key: "part_type", label: "部件类型", type: "multi", options: ["领子", "袖口", "口袋", "纽扣", "拉链", "腰带"], allowCustom: true, required: true },
      { key: "applicable", label: "适用款式", type: "multi", options: ["连衣裙", "上衣", "裤装", "半身裙", "外套"], allowCustom: true },
      { key: "craft_note", label: "工艺说明", type: "text", options: [] },
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

  const styles: DatasetStyle[] = [
    {
      id: "sty_1", styleId: "STY-001",
      images: [
        { url: "https://images.unsplash.com/photo-1551232864-3f0890e580d9?w=800&q=80", angle: "front", filename: "STY-001_front.jpg" },
        { url: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80", angle: "back", filename: "STY-001_back.jpg" },
      ],
      preselect: { production_tob: { category: ["连衣裙"] }, commercial_tob: { style: ["简约"] } },
    },
    {
      id: "sty_2", styleId: "STY-002",
      images: [{ url: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=800&q=80", angle: "front", filename: "STY-002_front.jpg" }],
      preselect: { production_tob: { category: ["上衣"] } },
    },
    {
      id: "sty_3", styleId: "STY-003",
      images: [
        { url: "https://images.unsplash.com/photo-1485518882345-15568b007407?w=800&q=80", angle: "front", filename: "STY-003_front.jpg" },
        { url: "https://images.unsplash.com/photo-1583744946564-b52ac1c389c8?w=800&q=80", angle: "detail", filename: "STY-003_detail.jpg" },
      ],
    },
  ];
  const styleDataset: Dataset = {
    id: "ds_style", name: "第一阶段款式数据集", description: "3 个款式（共 5 张图片）",
    styles, createdAt: Date.now(), updatedAt: Date.now(),
  };

  const fabricStyles: DatasetStyle[] = [
    { id: "fab_1", styleId: "FAB-001",
      images: [{ url: "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=800&q=80", angle: "正面", filename: "FAB-001.jpg" }],
      preselect: { production_tob: { composition: ["棉"] } } },
    { id: "fab_2", styleId: "FAB-002",
      images: [{ url: "https://images.unsplash.com/photo-1604176354204-9268737828e4?w=800&q=80", angle: "正面", filename: "FAB-002.jpg" }] },
  ];
  const fabricDataset: Dataset = {
    id: "ds_fabric", name: "第一阶段面料数据集", description: "2 个面料",
    styles: fabricStyles, createdAt: Date.now(), updatedAt: Date.now(),
  };

  const partStyles: DatasetStyle[] = [
    { id: "part_1", styleId: "PRT-001",
      images: [{ url: "https://images.unsplash.com/photo-1582142306909-195724d33ffc?w=800&q=80", angle: "细节", filename: "PRT-001.jpg" }],
      preselect: { production_tob: { part_type: ["领子"] } } },
    { id: "part_2", styleId: "PRT-002",
      images: [{ url: "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=800&q=80", angle: "细节", filename: "PRT-002.jpg" }] },
  ];
  const partDataset: Dataset = {
    id: "ds_part", name: "第一阶段部件数据集", description: "2 个部件",
    styles: partStyles, createdAt: Date.now(), updatedAt: Date.now(),
  };

  const users: User[] = [
    { pid: "P001", username: "admin", password: "admin", roles: ["admin"] },
    { pid: "P002", username: "annotator1", password: "123", roles: ["annotator"] },
    { pid: "P003", username: "annotator2", password: "123", roles: ["annotator"] },
    { pid: "P004", username: "reviewer1", password: "123", roles: ["reviewer"] },
    { pid: "P005", username: "lead", password: "123", roles: ["annotator", "reviewer"] },
    { pid: "P006", username: "superadmin", password: "123", roles: ["admin", "reviewer", "annotator"] },
  ];

  const styleTask: Task = {
    id: "task_style", name: "第一阶段款式库", datasetId: styleDataset.id, libraryKey: styleLib.key,
    annotators: [
      { userPid: "P002", perspectives: ["production_tob", "commercial_tob"] },
      { userPid: "P003", perspectives: ["commercial_toc"] },
    ],
    reviewers: ["P004"], deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), createdAt: Date.now(),
  };
  const fabricTask: Task = {
    id: "task_fabric", name: "第一阶段面料库", datasetId: fabricDataset.id, libraryKey: fabricLib.key,
    annotators: [{ userPid: "P002", perspectives: ["production_tob", "commercial_tob"] }],
    reviewers: ["P004"], deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), createdAt: Date.now(),
  };
  const partTask: Task = {
    id: "task_part", name: "第一阶段部件库", datasetId: partDataset.id, libraryKey: partLib.key,
    annotators: [{ userPid: "P003", perspectives: ["commercial_toc"] }],
    reviewers: ["P004"], deadline: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), createdAt: Date.now(),
  };

  return {
    users,
    libraries: [styleLib, fabricLib, partLib, commentLib],
    datasets: [styleDataset, fabricDataset, partDataset],
    tasks: [styleTask, fabricTask, partTask],
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

export function getAnnotation(taskId: string, styleId: string, perspective: Perspective): Annotation | undefined {
  const db = loadDB();
  return db.annotations.find((a) => a.taskId === taskId && a.styleId === styleId && a.perspective === perspective);
}

export function upsertAnnotation(a: Annotation) {
  const db = loadDB();
  const idx = db.annotations.findIndex((x) => x.id === a.id);
  if (idx >= 0) db.annotations[idx] = a;
  else db.annotations.push(a);
  saveDB(db);
}
