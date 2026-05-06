// ============================================================
// 多库可配置架构 - 库字段配置 (Single Source of Truth)
// ============================================================
//
// 本文件以 JSON 描述每个库的字段、控件类型、选项池、联动关系、
// 工艺-部位组合规则等。后端/前端均可根据此配置动态渲染表单。
//
// 控件类型 (FieldDef.type)：
//   - "multi"  : 多选标签按钮（强弱属性可配 weight）
//   - "single" : 单选
//   - "text"   : 自由文本输入
//   - "weight" : 权重滑块 (0-1) [扩展用]
//   - "craftPart" : 工艺-部位组（由 library.craftPart 配置）
//
// 字段属性：
//   - key, label, type, options
//   - allowCustom : 是否允许标注员添加自定义标签
//   - required    : 是否必填
//   - dependsOn / optionMap : 字段联动（如 品类→领型）
//   - perspectives : 仅在指定视角显示（缺省 = 三个视角通用）
//
// 扩展新库：在下方 LIBRARIES 中新增条目即可。
// 标注工作台与管理员"库管理"页面会自动读取并渲染。
// ============================================================

export const STYLE_LIBRARY = {
  key: "style",
  name: "款式库",
  fields: [
    { key: "category",   label: "品类",     type: "multi",  options: ["连衣裙", "上衣", "裤装", "半身裙"], allowCustom: true, required: true },
    { key: "silhouette", label: "廓形",     type: "multi",  options: ["A型", "H型", "X型", "O型"], allowCustom: true },
    { key: "neckline",   label: "领型",     type: "multi",  options: ["圆领", "V领", "翻领", "高腰", "松紧腰"], allowCustom: true,
      dependsOn: "category",
      optionMap: {
        "连衣裙": ["圆领", "V领", "翻领"],
        "上衣":   ["圆领", "V领", "翻领"],
        "裤装":   ["高腰", "松紧腰"],
        "半身裙": ["高腰", "松紧腰"],
      } },
    { key: "style",      label: "风格",     type: "multi",  options: ["简约", "复古", "运动", "通勤", "甜美"], allowCustom: true },
    { key: "color",      label: "颜色",     type: "multi",  options: ["黑", "白", "灰", "红", "蓝", "绿", "粉"], allowCustom: true },
    { key: "season",     label: "季节",     type: "multi",  options: ["春", "夏", "秋", "冬"] },
    { key: "craft",      label: "工艺类型", type: "multi",  options: ["压褶", "印花", "绣花", "洗水"], allowCustom: true },
    { key: "part",       label: "部位",     type: "multi",  options: ["前中部位", "前襟", "袖口", "下摆", "领口"], allowCustom: true },
  ],
  craftPart: {
    craftField: "craft",
    partField:  "part",
    rules: {
      "压褶": ["前中部位", "前襟", "下摆"],
      "印花": ["前中部位", "袖口", "下摆", "领口"],
      "绣花": ["前中部位", "袖口", "领口"],
      "洗水": ["前中部位", "前襟", "袖口", "下摆", "领口"],
    },
  },
};

// 占位：后续可加 面料库 / 辅料库 / 部件库 / 客户评语库 等
export const LIBRARIES = {
  style: STYLE_LIBRARY,
};

export default LIBRARIES;
