export type FieldKind =
  | "fixed-single"
  | "fixed-multi"
  | "reference-multi"
  | "free-text"
  | "free-textarea"
  | "number"
  | "weight-group";

export interface FieldOption {
  value: string;
  hint?: string; // for reference layer ⓘ
}

export interface FieldDef {
  key: string;
  label: { zh: string; en: string };
  kind: FieldKind;
  options?: FieldOption[];
  allowCustom?: boolean; // shows "+" to add new option
  weights?: { key: string; label: { zh: string; en: string } }[];
  // perspective visibility: if omitted -> visible always
  perspectives?: Array<"production" | "commercial">;
  // optional override label per perspective / audience
  labelOverride?: Partial<
    Record<"production" | "commercial" | "tob" | "toc", { zh: string; en: string }>
  >;
}

export interface LibraryDef {
  key: string;
  name: { zh: string; en: string };
  hasImage: boolean;
  fields: FieldDef[];
}

const SEASON_WEIGHTS = [
  { key: "spring", label: { zh: "春", en: "Spring" } },
  { key: "summer", label: { zh: "夏", en: "Summer" } },
  { key: "autumn", label: { zh: "秋", en: "Autumn" } },
  { key: "winter", label: { zh: "冬", en: "Winter" } },
];

const AGE_WEIGHTS = [
  { key: "child", label: { zh: "儿童", en: "Child" } },
  { key: "youth", label: { zh: "青年", en: "Youth" } },
  { key: "middle", label: { zh: "中年", en: "Middle" } },
  { key: "old", label: { zh: "老年", en: "Senior" } },
];

export const LIBRARIES: LibraryDef[] = [
  {
    key: "style_library",
    name: { zh: "款式库", en: "Style Library" },
    hasImage: true,
    fields: [
      {
        key: "category",
        label: { zh: "品类", en: "Category" },
        kind: "fixed-single",
        options: [
          { value: "连衣裙" }, { value: "上衣" }, { value: "裤装" }, { value: "半身裙" },
        ],
      },
      {
        key: "silhouette",
        label: { zh: "廓形", en: "Silhouette" },
        labelOverride: {
          commercial: { zh: "版型描述", en: "Fit Description" },
        },
        kind: "fixed-single",
        allowCustom: true,
        options: ["A型","H型","X型","O型","T型"].map(v=>({value:v})),
      },
      {
        key: "collar",
        label: { zh: "领型", en: "Collar" },
        kind: "fixed-single",
        allowCustom: true,
        options: ["圆领","V领","方领","立领","衬衫领"].map(v=>({value:v})),
        perspectives: ["production"],
      },
      {
        key: "style_tags",
        label: { zh: "风格", en: "Style" },
        kind: "reference-multi",
        options: [
          { value: "简约", hint: "线条简洁，无过多装饰" },
          { value: "复古", hint: "参考70-90年代廓形与色彩" },
          { value: "运动", hint: "强调机能与舒适" },
          { value: "通勤", hint: "适合职场，干练利落" },
          { value: "甜美", hint: "粉彩、蕾丝、蝴蝶结等元素" },
        ],
        perspectives: ["commercial"],
      },
      {
        key: "color_desc",
        label: { zh: "颜色描述", en: "Color Description" },
        kind: "free-text",
        perspectives: ["commercial"],
      },
      {
        key: "craft_desc",
        label: { zh: "工艺细节描述", en: "Craft Detail" },
        labelOverride: { toc: { zh: "工艺亮点", en: "Craft Highlight" } },
        kind: "free-textarea",
        perspectives: ["production"],
      },
      {
        key: "season_weight",
        label: { zh: "季节权重", en: "Season Weight" },
        kind: "weight-group",
        weights: SEASON_WEIGHTS,
        perspectives: ["production"],
      },
      {
        key: "age_group_weight",
        label: { zh: "适用年龄段", en: "Age Group" },
        kind: "weight-group",
        weights: AGE_WEIGHTS,
        perspectives: ["commercial"],
      },
    ],
  },
  {
    key: "fabric_library",
    name: { zh: "面料库", en: "Fabric Library" },
    hasImage: true,
    fields: [
      { key: "fabric_name", label: { zh: "面料名称", en: "Fabric Name" }, kind: "free-text" },
      {
        key: "composition",
        label: { zh: "成分", en: "Composition" },
        labelOverride: { commercial: { zh: "面料组成", en: "Fabric Make-up" } },
        kind: "fixed-multi", allowCustom: true,
        options: ["棉","麻","丝","毛","化纤","混纺"].map(v=>({value:v})),
      },
      { key: "weight_gsm", label: { zh: "克重 (g/m²)", en: "Weight (g/m²)" }, kind: "number" },
      {
        key: "hand_feel",
        label: { zh: "手感", en: "Hand Feel" },
        labelOverride: { commercial: { zh: "触感体验", en: "Touch Experience" } },
        kind: "fixed-single",
        options: ["柔软","适中","硬挺"].map(v=>({value:v})),
      },
      {
        key: "pattern", label: { zh: "花型", en: "Pattern" }, kind: "reference-multi",
        options: [
          { value: "素色", hint: "无图案纯色面料" },
          { value: "条纹", hint: "横纹/竖纹" },
          { value: "格纹", hint: "苏格兰/千鸟格等" },
          { value: "印花", hint: "印染图案" },
          { value: "提花", hint: "织造时形成图案" },
        ],
      },
      {
        key: "season_weight", label: { zh: "适用季节", en: "Suitable Season" },
        kind: "weight-group", weights: SEASON_WEIGHTS,
      },
    ],
  },
  {
    key: "trim_library",
    name: { zh: "辅料库", en: "Trim Library" },
    hasImage: true,
    fields: [
      { key: "trim_type", label: { zh: "辅料类型", en: "Trim Type" }, kind: "fixed-single",
        options: ["拉链","纽扣","蕾丝","织带","衬布"].map(v=>({value:v})) },
      { key: "material", label: { zh: "材质", en: "Material" },
        labelOverride: { commercial: { zh: "质感", en: "Texture" } },
        kind: "fixed-single", allowCustom: true,
        options: ["金属","树脂","天然","化纤"].map(v=>({value:v})) },
      { key: "color", label: { zh: "颜色", en: "Color" }, kind: "free-text" },
      { key: "size", label: { zh: "尺寸", en: "Size" }, kind: "free-text" },
    ],
  },
  {
    key: "craft_library",
    name: { zh: "特殊工艺库", en: "Special Craft Library" },
    hasImage: true,
    fields: [
      { key: "craft_name", label: { zh: "工艺名称", en: "Craft Name" }, kind: "free-text" },
      { key: "craft_type", label: { zh: "工艺类型", en: "Craft Type" }, kind: "fixed-single",
        options: ["印花","绣花","压褶","洗水","做旧"].map(v=>({value:v})) },
      { key: "complexity", label: { zh: "工艺复杂度", en: "Complexity" },
        labelOverride: { commercial: { zh: "工艺等级", en: "Craft Tier" } },
        kind: "fixed-single", options: ["低","中","高"].map(v=>({value:v})) },
      { key: "effect_desc", label: { zh: "效果描述", en: "Effect Description" }, kind: "free-textarea" },
    ],
  },
  {
    key: "part_library",
    name: { zh: "部件库", en: "Part Library" },
    hasImage: true,
    fields: [
      { key: "part_type", label: { zh: "部件类型", en: "Part Type" }, kind: "fixed-single",
        options: ["领子","袖子","口袋","腰头","门襟"].map(v=>({value:v})) },
      { key: "part_name", label: { zh: "部件名称", en: "Part Name" }, kind: "reference-multi",
        options: [
          { value: "衬衫领", hint: "标准衬衫翻领造型" },
          { value: "泡泡袖", hint: "袖山抽褶蓬起" },
          { value: "贴袋", hint: "缝在衣身表面的口袋" },
        ], allowCustom: true },
      { key: "applicable", label: { zh: "适用款式", en: "Applicable Styles" },
        labelOverride: { commercial: { zh: "搭配款式", en: "Pairing Styles" } },
        kind: "fixed-multi", allowCustom: true,
        options: ["连衣裙","上衣","外套","裤装"].map(v=>({value:v})) },
      { key: "craft_note", label: { zh: "工艺说明", en: "Craft Note" }, kind: "free-textarea" },
    ],
  },
  {
    key: "comment_library",
    name: { zh: "客户评语库", en: "Customer Comment Library" },
    hasImage: false,
    fields: [
      { key: "customer_name", label: { zh: "客户名称", en: "Customer Name" }, kind: "free-text" },
      { key: "comment", label: { zh: "评语内容", en: "Comment" }, kind: "free-textarea" },
      { key: "sentiment", label: { zh: "情感倾向", en: "Sentiment" }, kind: "fixed-single",
        options: [
          { value: "正面" }, { value: "中性" }, { value: "负面" },
        ] },
      { key: "categories", label: { zh: "涉及品类", en: "Related Categories" },
        kind: "fixed-multi", allowCustom: true,
        options: ["连衣裙","T恤","外套","裤装","半身裙"].map(v=>({value:v})) },
      { key: "keywords", label: { zh: "关键词提取（逗号分隔）", en: "Keywords (comma)" }, kind: "free-text" },
    ],
  },
];

export const MOCK_IMAGES = [
  { id: "img_001", url: "https://images.unsplash.com/photo-1551232864-3f0890e580d9?w=900&q=80" },
  { id: "img_002", url: "https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=900&q=80" },
  { id: "img_003", url: "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=900&q=80" },
];

export const UI_TEXT = {
  zh: {
    appTitle: "服装多库数据标注平台",
    currentLib: "当前库",
    taskId: "任务",
    progress: "进度",
    save: "暂存",
    submit: "提交标注",
    prev: "上一张",
    next: "下一张",
    perspective: "视角",
    production: "生产制造",
    commercial: "商业销售",
    audience: "受众",
    language: "语言",
    customTags: "自定义标签",
    addCustomTag: "+ 添加自定义标签",
    history: "历史标注记录",
    addOption: "添加选项",
    inputNew: "输入新选项名称",
    confirm: "确定",
    cancel: "取消",
    noImage: "本库无图片",
    commentInput: "评语标注（无图片）",
    saved: "已暂存到本地",
    submitted: "已提交，请查看控制台",
    hover: "悬停查看大图",
  },
  en: {
    appTitle: "Garment Multi-Library Annotation",
    currentLib: "Library",
    taskId: "Task",
    progress: "Progress",
    save: "Save",
    submit: "Submit",
    prev: "Prev",
    next: "Next",
    perspective: "Perspective",
    production: "Production",
    commercial: "Commercial",
    audience: "Audience",
    language: "Language",
    customTags: "Custom Tags",
    addCustomTag: "+ Add Custom Tag",
    history: "Annotation History",
    addOption: "Add option",
    inputNew: "Enter new option name",
    confirm: "OK",
    cancel: "Cancel",
    noImage: "No image",
    commentInput: "Comment annotation (no image)",
    saved: "Saved locally",
    submitted: "Submitted, see console",
    hover: "Hover to zoom",
  },
};
