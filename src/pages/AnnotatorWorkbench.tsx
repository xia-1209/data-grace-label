import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import {
  Annotation,
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
import { Lock, Pencil, X, ZoomIn, RotateCw, ChevronLeft, ChevronRight, Plus, HelpCircle } from "lucide-react";
import { toast } from "sonner";

interface DraftMap {
  [perspective: string]: {
    data: Record<string, string[]>;
    craftPartGroups: CraftPartGroup[];
    customTags: string[];
  };
}

function emptyDraft() {
  return { data: {}, craftPartGroups: [], customTags: [] };
}

export default function AnnotatorWorkbench() {
  const { taskId } = useParams();
  const db = useDB();
  const { user } = useAuth();
  const nav = useNavigate();

  const task = db.tasks.find((t) => t.id === taskId);
  const dataset = db.datasets.find((d) => d.id === task?.datasetId);
  const library = db.libraries.find((l) => l.key === task?.libraryKey);
  const myAssignment = task?.annotators.find((a) => a.userPid === user?.pid);
  const editablePerspectives = myAssignment?.perspectives || [];

  const [imgIdx, setImgIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const [drafts, setDrafts] = useState<DraftMap>({});

  const image = dataset?.images[imgIdx];

  // Load existing data when image changes
  useEffect(() => {
    if (!image || !task) return;
    const next: DraftMap = {};
    PERSPECTIVES.forEach((p) => {
      const a = getAnnotation(task.id, image.id, p);
      next[p] = a
        ? { data: a.data as Record<string, string[]>, craftPartGroups: a.craftPartGroups || [], customTags: a.customTags }
        : emptyDraft();
    });
    setDrafts(next);
    setZoom(1);
    setRot(0);
  }, [image?.id, task?.id]);

  const saveAll = (status: "drafted" | "submitted") => {
    if (!task || !image || !user) return;
    let count = 0;
    PERSPECTIVES.forEach((p) => {
      if (!editablePerspectives.includes(p)) return;
      const draft = drafts[p];
      if (!draft) return;
      const isEmpty = Object.keys(draft.data).length === 0 && draft.craftPartGroups.length === 0 && draft.customTags.length === 0;
      if (status === "submitted" && isEmpty) return;
      const existing = getAnnotation(task.id, image.id, p);
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
    log(status === "submitted" ? "submit_annotation" : "save_draft", user.pid, `task=${task.id} img=${image.id} n=${count}`);
    toast.success(status === "submitted" ? `已提交 ${count} 个视角` : `已保存草稿 ${count} 个视角`);
  };

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        saveAll("drafted");
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        saveAll("submitted");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (!task || !dataset || !library || !user) return <div className="p-6">任务不存在</div>;

  const updateDraft = (p: Perspective, fn: (d: DraftMap[string]) => DraftMap[string]) => {
    setDrafts((prev) => ({ ...prev, [p]: fn(prev[p] || emptyDraft()) }));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="border-b px-4 py-2 flex items-center gap-3 bg-card">
        <Link to="/annotator" className="text-sm text-primary">← 返回任务列表</Link>
        <div className="font-semibold">{task.name}</div>
        <div className="text-sm text-muted-foreground">第 {imgIdx + 1} / {dataset.images.length} 张</div>
        <div className="ml-auto text-xs text-muted-foreground">
          快捷键：Ctrl+S 保存 · Ctrl+Enter 提交
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {/* image */}
        <div className="w-[420px] border-r bg-muted/30 flex flex-col">
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            {image ? (
              <img
                src={image.url}
                alt={image.filename}
                style={{ transform: `scale(${zoom}) rotate(${rot}deg)`, transition: "transform .2s" }}
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <div className="text-muted-foreground">无图片</div>
            )}
          </div>
          <div className="p-2 border-t bg-card flex items-center gap-2 justify-center">
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}><ZoomIn className="rotate-180" /></Button>
            <Button size="icon" variant="outline" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}><ZoomIn /></Button>
            <Button size="icon" variant="outline" onClick={() => setRot((r) => r + 90)}><RotateCw /></Button>
            <Button size="icon" variant="outline" disabled={imgIdx === 0} onClick={() => setImgIdx((i) => i - 1)}><ChevronLeft /></Button>
            <Button size="icon" variant="outline" disabled={imgIdx === dataset.images.length - 1} onClick={() => setImgIdx((i) => i + 1)}><ChevronRight /></Button>
          </div>
        </div>

        {/* perspectives */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {PERSPECTIVES.map((p) => {
            const editable = editablePerspectives.includes(p);
            const draft = drafts[p] || emptyDraft();
            return (
              <Card key={p} className={`p-4 ${editable ? "" : "bg-muted/40"}`}>
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
      </div>

      <div className="border-t px-4 py-3 flex gap-2 justify-end bg-card">
        <Button variant="outline" onClick={() => {
          const reason = prompt("跳过原因（可选）") || "";
          log("skip_image", user.pid, `task=${task.id} img=${image?.id} reason=${reason}`);
          toast.info("已跳过");
          if (imgIdx < dataset.images.length - 1) setImgIdx(imgIdx + 1);
        }}>跳过</Button>
        <Button variant="outline" onClick={() => saveAll("drafted")}>保存草稿</Button>
        <Button onClick={() => saveAll("submitted")}>提交</Button>
      </div>
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
      // request approval
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

  return (
    <div className="space-y-4">
      {library.fields.map((f) => {
        const isCraftPartField = cp && (f.key === cp.craftField || f.key === cp.partField);
        if (isCraftPartField) return null; // handled separately
        const selected = draft.data[f.key] || [];
        return (
          <div key={f.key}>
            <div className="flex items-center gap-1 text-sm font-medium mb-2">
              {f.label}
              {f.required && <span className="text-destructive">*</span>}
            </div>
            {f.type === "text" ? (
              <Input disabled={!editable} value={selected[0] || ""} onChange={(e) => setText(f.key, e.target.value)} />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...f.options, ...selected])].map((opt) => (
                    <button
                      key={opt}
                      disabled={!editable}
                      onClick={() => toggleOption(f.key, opt)}
                      className={`px-3 py-1 rounded-full border text-xs flex items-center gap-1 ${
                        selected.includes(opt)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted"
                      } ${!editable ? "opacity-70 cursor-not-allowed" : ""}`}
                    >
                      {opt}
                      <HelpCircle
                        className="w-3 h-3 opacity-60"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert(`${opt}\n\n(规则提示：定义/判断标准/正例。)`);
                        }}
                      />
                    </button>
                  ))}
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

      {draft.customTags.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-xs text-muted-foreground mb-1">自定义标签：</div>
          <div className="flex flex-wrap gap-1">
            {draft.customTags.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent-foreground">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
