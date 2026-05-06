import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import {
  Annotation,
  AnnoStatus,
  CraftPartGroup,
  PERSPECTIVES,
  PERSPECTIVE_LABEL,
  Perspective,
  getAnnotation,
  loadDB,
  log,
  saveDB,
  uid,
  upsertAnnotation,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Lock, Pencil, X, ZoomIn, RotateCw, ChevronLeft, ChevronRight, Plus, HelpCircle, BookOpen, Sparkles, ChevronsRight } from "lucide-react";
import { toast } from "sonner";

interface DraftMap {
  [perspective: string]: {
    data: Record<string, string[]>;
    craftPartGroups: CraftPartGroup[];
    customTags: string[];
    dirty?: boolean;
  };
}

function emptyDraft() {
  return { data: {}, craftPartGroups: [], customTags: [], dirty: false };
}

const STATUSES: { key: AnnoStatus | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "not_started", label: "未打标" },
  { key: "drafted", label: "草稿" },
  { key: "submitted", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已打回" },
];

export default function AnnotatorWorkbench() {
  const { taskId } = useParams();
  const db = useDB();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const task = db.tasks.find((t) => t.id === taskId);
  const dataset = db.datasets.find((d) => d.id === task?.datasetId);
  const library = db.libraries.find((l) => l.key === task?.libraryKey);
  const myAssignment = task?.annotators.find((a) => a.userPid === user?.pid);
  const editablePerspectives = myAssignment?.perspectives || [];

  const filterStatus = (params.get("status") as AnnoStatus | "all") || "not_started";

  // Compute image-level "rollup" status for filter (worst of editable perspectives)
  const imageStatus = (imgId: string): AnnoStatus => {
    if (!task) return "not_started";
    const myPersps = editablePerspectives;
    const annos = myPersps.map((p) => db.annotations.find((a) => a.taskId === task.id && a.imageId === imgId && a.perspective === p));
    if (annos.every((a) => !a)) return "not_started";
    if (annos.some((a) => a?.status === "rejected")) return "rejected";
    if (annos.some((a) => a?.status === "submitted")) return "submitted";
    if (annos.some((a) => a?.status === "approved") && annos.every((a) => !a || a.status === "approved")) return "approved";
    if (annos.some((a) => a?.status === "drafted")) return "drafted";
    return "not_started";
  };

  const filteredImages = useMemo(() => {
    if (!dataset) return [];
    if (filterStatus === "all") return dataset.images;
    return dataset.images.filter((i) => imageStatus(i.id) === filterStatus);
  }, [dataset, filterStatus, db.annotations, editablePerspectives.join(",")]);

  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => { setImgIdx(0); }, [filterStatus]);
  const image = filteredImages[imgIdx];

  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // Load existing data when image changes
  useEffect(() => {
    if (!image || !task) return;
    const next: DraftMap = {};
    PERSPECTIVES.forEach((p) => {
      const a = getAnnotation(task.id, image.id, p);
      const preselect = image.preselect?.[p];
      next[p] = a
        ? { data: a.data as Record<string, string[]>, craftPartGroups: a.craftPartGroups || [], customTags: a.customTags, dirty: false }
        : { data: preselect ? { ...preselect } : {}, craftPartGroups: [], customTags: [], dirty: !!preselect };
    });
    setDrafts(next);
    setZoom(1);
    setRot(0);
  }, [image?.id, task?.id]);

  const validate = (): string | null => {
    if (!library) return null;
    for (const p of editablePerspectives) {
      const d = drafts[p];
      if (!d) continue;
      for (const f of library.fields) {
        if (f.required && !(d.data[f.key] && d.data[f.key].length > 0)) {
          return `视角「${PERSPECTIVE_LABEL[p]}」必填字段「${f.label}」未填写`;
        }
      }
    }
    return null;
  };

  const saveAll = (status: "drafted" | "submitted", silent = false) => {
    if (!task || !image || !user) return;
    if (status === "submitted") {
      const err = validate();
      if (err) { toast.error(err); return; }
    }
    let count = 0;
    PERSPECTIVES.forEach((p) => {
      if (!editablePerspectives.includes(p)) return;
      const draft = drafts[p];
      if (!draft) return;
      const isEmpty = Object.keys(draft.data).length === 0 && draft.craftPartGroups.length === 0 && draft.customTags.length === 0;
      if (status === "submitted" && isEmpty) return;
      if (status === "drafted" && isEmpty && !draft.dirty) return;
      const existing = getAnnotation(task.id, image.id, p);
      // Don't overwrite already-submitted/approved with autosave drafted
      if (silent && existing && ["submitted", "approved"].includes(existing.status)) return;
      const a: Annotation = {
        id: existing?.id || uid(),
        taskId: task.id,
        imageId: image.id,
        perspective: p,
        status,
        data: draft.data,
        craftPartGroups: draft.craftPartGroups,
        customTags: draft.customTags,
        annotatorPid: user.pid,
        history: [...(existing?.history || []), { ts: Date.now(), status, by: user.pid }],
        updatedAt: Date.now(),
      };
      upsertAnnotation(a);
      count++;
    });
    if (count > 0) {
      log(status === "submitted" ? "submit_annotation" : "save_draft", user.pid, `task=${task.id} img=${image.id} n=${count}`);
      if (!silent) toast.success(status === "submitted" ? `已提交 ${count} 个视角` : `已保存草稿 ${count} 个视角`);
    }
  };

  // Auto-save every 30s
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    const t = setInterval(() => saveAll("drafted", true), 30000);
    return () => clearInterval(t);
  }, [image?.id, task?.id]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") { e.preventDefault(); saveAll("drafted"); }
      else if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); saveAll("submitted"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!task || !dataset || !library || !user) return <div className="p-6">任务不存在</div>;

  const updateDraft = (p: Perspective, fn: (d: DraftMap[string]) => DraftMap[string]) => {
    setDrafts((prev) => ({ ...prev, [p]: { ...fn(prev[p] || emptyDraft()), dirty: true } }));
  };

  const aiPreLabel = () => {
    editablePerspectives.forEach((p) => {
      updateDraft(p, (d) => {
        const next = { ...d, data: { ...d.data } };
        library.fields.forEach((f) => {
          if (f.type === "text" || (next.data[f.key] && next.data[f.key].length > 0)) return;
          if (f.options.length === 0) return;
          const pick = [...f.options].sort(() => 0.5 - Math.random()).slice(0, 1 + Math.floor(Math.random() * 2));
          next.data[f.key] = pick;
        });
        return next;
      });
    });
    toast.success("AI 预标注完成（mock），请人工审核调整");
  };

  const batchSubmit = () => {
    if (!task) return;
    const targets = filteredImages.filter((img) => imageStatus(img.id) === "drafted");
    let total = 0;
    targets.forEach((img) => {
      PERSPECTIVES.forEach((p) => {
        if (!editablePerspectives.includes(p)) return;
        const ex = getAnnotation(task.id, img.id, p);
        if (ex && ex.status === "drafted") {
          ex.status = "submitted";
          ex.history.push({ ts: Date.now(), status: "submitted", by: user.pid });
          ex.updatedAt = Date.now();
          upsertAnnotation(ex);
          total++;
        }
      });
    });
    log("batch_submit", user.pid, `task=${task.id} n=${total}`);
    toast.success(`批量提交 ${total} 个视角`);
    setShowBatch(false);
  };

  const isComment = library.key === "comment";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="border-b px-4 py-2 flex items-center gap-3 bg-card flex-wrap">
        <Link to="/annotator" className="text-sm text-primary">← 返回</Link>
        <div className="font-semibold">{task.name}</div>
        <div className="flex gap-1 ml-2">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setParams({ status: s.key })}
              className={`text-xs px-2 py-1 rounded ${filterStatus === s.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="text-sm text-muted-foreground">第 {filteredImages.length === 0 ? 0 : imgIdx + 1} / {filteredImages.length} 张</div>
        <div className="ml-auto text-xs text-muted-foreground">Ctrl+S 草稿 · Ctrl+Enter 提交 · 30s 自动保存</div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* image */}
        <div className="w-[380px] border-r bg-muted/30 flex flex-col">
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            {!image ? (
              <div className="text-muted-foreground text-sm">无符合筛选的图片</div>
            ) : isComment ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm">
                <div className="border-2 border-dashed rounded p-6 text-center">
                  <div className="mb-2">无图片（评语库）</div>
                  <textarea
                    placeholder="客户评语文本…"
                    className="border rounded p-2 text-sm w-72 h-32 bg-background text-foreground"
                  />
                </div>
              </div>
            ) : (
              <img
                src={image.url}
                alt={image.filename}
                style={{ transform: `scale(${zoom}) rotate(${rot}deg)`, transition: "transform .2s" }}
                className="max-w-full max-h-full object-contain"
              />
            )}
          </div>
          <div className="p-2 border-t bg-card flex items-center gap-1 justify-center flex-wrap">
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}><ZoomIn className="rotate-180" /></Button>
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}><ZoomIn /></Button>
            <Button size="icon" variant="outline" onClick={() => setRot((r) => r + 90)}><RotateCw /></Button>
            <Button size="icon" variant="outline" disabled={imgIdx === 0} onClick={() => setImgIdx((i) => i - 1)}><ChevronLeft /></Button>
            <Button size="icon" variant="outline" disabled={imgIdx >= filteredImages.length - 1} onClick={() => setImgIdx((i) => i + 1)}><ChevronRight /></Button>
          </div>
        </div>

        {/* perspectives */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {!image && <div className="text-muted-foreground text-sm">该筛选下没有图片</div>}
          {image && PERSPECTIVES.map((p) => {
            const editable = editablePerspectives.includes(p);
            const draft = drafts[p] || emptyDraft();
            return (
              <Card key={p} className={`p-4 ${editable ? "border-primary/30" : "bg-muted/40"}`}>
                <div className="flex items-center gap-2 mb-3">
                  {editable ? <Pencil className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                  <h3 className="font-semibold">{PERSPECTIVE_LABEL[p]}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded ${editable ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {editable ? "可编辑" : "只读"}
                  </span>
                </div>
                <PerspectiveForm
                  library={library}
                  draft={draft}
                  editable={editable}
                  onChange={(fn) => updateDraft(p, fn)}
                />
              </Card>
            );
          })}
        </div>

        {/* right panel */}
        {panelOpen && image && (
          <div className="w-72 border-l bg-card overflow-auto p-3 space-y-3 text-sm">
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => setPanelOpen(false)}><ChevronsRight className="w-3 h-3" />收起面板</Button>
            <Button size="sm" variant="outline" className="w-full" onClick={() => setShowRulesModal(true)}>
              <BookOpen className="w-3 h-3" /> 标注规范
            </Button>
            <div>
              <div className="font-medium mb-1">参考图库</div>
              <div className="grid grid-cols-2 gap-2">
                {dataset.images.filter((i) => i.id !== image.id).slice(0, 4).map((i) => (
                  <img key={i.id} src={i.url} className="w-full h-20 object-cover rounded cursor-zoom-in" onClick={() => window.open(i.url, "_blank")} alt="" />
                ))}
              </div>
            </div>
            <div>
              <div className="font-medium mb-1">本图自定义标签</div>
              <div className="flex flex-wrap gap-1">
                {Object.values(drafts).flatMap((d) => d?.customTags || []).map((t, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded bg-accent/30">{t}</span>
                ))}
              </div>
            </div>
            {library.craftPart && (
              <div>
                <div className="font-medium mb-1">工艺-部位参考表</div>
                <div className="text-xs space-y-0.5 text-muted-foreground">
                  {Object.entries(library.craftPart.rules).map(([c, ps]) => (
                    <div key={c}><b className="text-foreground">{c}</b>: {ps.join(", ")}</div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="font-medium mb-1">历史记录</div>
              <div className="text-xs space-y-1 max-h-40 overflow-auto">
                {PERSPECTIVES.flatMap((p) => {
                  const a = getAnnotation(task.id, image.id, p);
                  if (!a) return [];
                  return a.history.slice(-3).map((h, i) => (
                    <div key={`${p}-${i}`} className="border-l-2 pl-2 border-muted">
                      <span className="text-muted-foreground">{new Date(h.ts).toLocaleString()}</span>
                      <span className="ml-1">{PERSPECTIVE_LABEL[p].slice(0, 4)} · {h.status}</span>
                    </div>
                  ));
                })}
              </div>
            </div>
          </div>
        )}
        {!panelOpen && (
          <button className="absolute right-0 top-20 bg-card border-l border-y rounded-l px-1 py-2" onClick={() => setPanelOpen(true)}>
            <ChevronLeft className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="border-t px-4 py-3 flex gap-2 justify-end bg-card flex-wrap">
        <Button variant="outline" size="sm" onClick={aiPreLabel}><Sparkles className="w-3 h-3" />AI 预标注</Button>
        <Button variant="outline" size="sm" onClick={() => {
          const reason = prompt("跳过原因（可选）") || "";
          log("skip_image", user.pid, `task=${task.id} img=${image?.id} reason=${reason}`);
          toast.info("已跳过");
          if (imgIdx < filteredImages.length - 1) setImgIdx(imgIdx + 1);
        }}>跳过</Button>
        <Button variant="outline" size="sm" onClick={() => setShowBatch(true)}>批量提交</Button>
        <Button variant="outline" size="sm" onClick={() => saveAll("drafted")}>保存草稿</Button>
        <Button size="sm" onClick={() => saveAll("submitted")}>提交</Button>
      </div>

      {/* Rules modal */}
      <Dialog open={showRulesModal} onOpenChange={setShowRulesModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>📘 标注规范</DialogTitle></DialogHeader>
          <div className="text-sm space-y-2 max-h-96 overflow-auto">
            <p>1. 多选字段：选择所有适用项，至少选 1 项标记为必填的字段。</p>
            <p>2. 工艺-部位组：每个工艺允许的部位由库管理员维护，请按实际可见组合添加。</p>
            <p>3. 自定义标签：仅在固定选项无法描述时使用，提交后进入审核流程。</p>
            <p>4. 视角差异：生产 ToB 注重工艺/材料；商业 ToB 注重款式定位；商业 ToC 注重消费者感受。</p>
            <p>5. 字段联动：依赖字段（如品类）的变化会刷新关联字段（如领型）的可选项。</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch submit dialog */}
      <Dialog open={showBatch} onOpenChange={setShowBatch}>
        <DialogContent>
          <DialogHeader><DialogTitle>批量提交</DialogTitle></DialogHeader>
          <div className="text-sm">
            将提交以下 {filteredImages.filter((i) => imageStatus(i.id) === "drafted").length} 张图片的所有草稿视角：
            <ul className="mt-2 max-h-60 overflow-auto text-xs">
              {filteredImages.filter((i) => imageStatus(i.id) === "drafted").map((i) => (
                <li key={i.id}>· {i.filename}</li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBatch(false)}>取消</Button>
            <Button onClick={batchSubmit}>确认提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PerspectiveForm({
  library,
  draft,
  editable,
  onChange,
}: {
  library: ReturnType<typeof loadDB>["libraries"][number];
  draft: { data: Record<string, string[]>; craftPartGroups: CraftPartGroup[]; customTags: string[] };
  editable: boolean;
  onChange: (fn: (d: any) => any) => void;
}) {
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const cp = library.craftPart;

  const toggleOption = (fk: string, opt: string) => {
    if (!editable) return;
    onChange((d) => {
      const cur = d.data[fk] || [];
      const next = cur.includes(opt) ? cur.filter((x: string) => x !== opt) : [...cur, opt];
      return { ...d, data: { ...d.data, [fk]: next } };
    });
  };

  const setText = (fk: string, val: string) => {
    onChange((d) => ({ ...d, data: { ...d.data, [fk]: [val] } }));
  };

  const addCustom = (fk: string) => {
    const v = (customInputs[fk] || "").trim();
    if (!v) return;
    const field = library.fields.find((f) => f.key === fk);
    if (field && !field.options.includes(v)) {
      const db = loadDB();
      db.tagRequests.push({ id: uid(), libraryKey: library.key, fieldKey: fk, value: v, byPid: "P_self", status: "pending", ts: Date.now() });
      saveDB(db);
    }
    onChange((d) => ({
      ...d,
      data: { ...d.data, [fk]: [...(d.data[fk] || []), v] },
      customTags: d.customTags.includes(v) ? d.customTags : [...d.customTags, v],
    }));
    setCustomInputs((p) => ({ ...p, [fk]: "" }));
  };

  // Get rule for a specific tag
  const getRule = (fieldKey: string, value: string) => {
    const db = loadDB();
    return db.rules.find((r) => r.libraryKey === library.key && r.fieldKey === fieldKey && r.optionValue === value);
  };

  return (
    <div className="space-y-4">
      {library.fields.map((f) => {
        const isCraftPartField = cp && (f.key === cp.craftField || f.key === cp.partField);
        if (isCraftPartField) return null;
        const selected = draft.data[f.key] || [];
        // Linkage: if field has dependsOn + optionMap, restrict options based on dependency selection
        let availableOptions = f.options;
        if (f.dependsOn && f.optionMap) {
          const depVals = draft.data[f.dependsOn] || [];
          const allowed = new Set<string>();
          depVals.forEach((dv) => (f.optionMap![dv] || []).forEach((o) => allowed.add(o)));
          if (depVals.length > 0) availableOptions = Array.from(allowed);
        }
        return (
          <div key={f.key}>
            <div className="flex items-center gap-1 text-sm font-medium mb-2">
              {f.label}
              {f.required && <span className="text-destructive">*</span>}
              {f.dependsOn && <span className="text-xs text-muted-foreground">（依赖 {library.fields.find((x) => x.key === f.dependsOn)?.label}）</span>}
            </div>
            {f.type === "text" ? (
              <Input disabled={!editable} value={selected[0] || ""} onChange={(e) => setText(f.key, e.target.value)} />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...availableOptions, ...selected])].map((opt) => {
                    const rule = getRule(f.key, opt);
                    return (
                      <button
                        key={opt}
                        disabled={!editable}
                        onClick={() => toggleOption(f.key, opt)}
                        className={`px-3 py-1 rounded-full border text-xs flex items-center gap-1 ${
                          selected.includes(opt)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted"
                        } ${!editable ? "opacity-70 cursor-not-allowed" : ""}`}
                        title={rule ? `${rule.definition}\n${rule.criteria}` : "暂无规则"}
                      >
                        {opt}
                        <HelpCircle className="w-3 h-3 opacity-60" />
                      </button>
                    );
                  })}
                </div>
                {f.allowCustom && editable && (
                  <div className="flex gap-2 mt-2">
                    <Input
                      placeholder="新自定义标签"
                      value={customInputs[f.key] || ""}
                      onChange={(e) => setCustomInputs((p) => ({ ...p, [f.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom(f.key))}
                      className="h-8"
                    />
                    <Button size="sm" variant="outline" onClick={() => addCustom(f.key)}><Plus className="w-3 h-3" />添加</Button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {cp && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">工艺-部位组合</div>
            {editable && (
              <Button size="sm" variant="outline" onClick={() => onChange((d) => ({ ...d, craftPartGroups: [...d.craftPartGroups, { craft: "", parts: [] }] }))}>
                <Plus className="w-3 h-3" />添加组
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {draft.craftPartGroups.map((g, gi) => {
              const craftField = library.fields.find((f) => f.key === cp.craftField);
              const allowed = cp.rules[g.craft] || [];
              return (
                <div key={gi} className="border rounded p-2 space-y-2 bg-muted/30">
                  <div className="flex items-center gap-2">
                    <span className="text-xs">工艺：</span>
                    <select
                      disabled={!editable}
                      className="border rounded px-2 py-1 text-sm bg-background"
                      value={g.craft}
                      onChange={(e) =>
                        onChange((d) => {
                          const arr = [...d.craftPartGroups];
                          arr[gi] = { craft: e.target.value, parts: [] };
                          return { ...d, craftPartGroups: arr };
                        })
                      }
                    >
                      <option value="">选择工艺</option>
                      {craftField?.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                    {editable && (
                      <Button size="icon" variant="ghost" onClick={() =>
                        onChange((d) => ({ ...d, craftPartGroups: d.craftPartGroups.filter((_: any, i: number) => i !== gi) }))
                      }><X className="w-3 h-3" /></Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allowed.map((p) => (
                      <button
                        key={p}
                        disabled={!editable}
                        onClick={() =>
                          onChange((d) => {
                            const arr = [...d.craftPartGroups];
                            const cur = arr[gi].parts;
                            arr[gi] = { ...arr[gi], parts: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] };
                            return { ...d, craftPartGroups: arr };
                          })
                        }
                        className={`px-2 py-1 rounded border text-xs ${g.parts.includes(p) ? "bg-accent text-accent-foreground border-accent" : ""}`}
                      >
                        {p}
                      </button>
                    ))}
                    {g.craft && allowed.length === 0 && <span className="text-xs text-muted-foreground">该工艺暂无可选部位</span>}
                  </div>
                </div>
              );
            })}
            {draft.craftPartGroups.length === 0 && <div className="text-xs text-muted-foreground">尚未添加</div>}
          </div>
        </div>
      )}
    </div>
  );
}
