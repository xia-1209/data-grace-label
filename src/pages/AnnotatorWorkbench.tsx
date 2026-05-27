import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import {
  Annotation,
  AnnoStatus,
  CraftPartGroup,
  RelationGroup,
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Lock, Pencil, X, Plus, HelpCircle, BookOpen, Sparkles, History, RotateCcw, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { toast } from "sonner";

interface DraftMap {
  [perspective: string]: {
    data: Record<string, string[]>;
    craftPartGroups: CraftPartGroup[];
    relationGroups: RelationGroup[];
    customTags: string[];
    dirty?: boolean;
  };
}
const emptyDraft = () => ({ data: {}, craftPartGroups: [], relationGroups: [], customTags: [], dirty: false });

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

  const task = db.tasks.find((t) => t.id === taskId);
  const dataset = db.datasets.find((d) => d.id === task?.datasetId);
  const library = db.libraries.find((l) => l.key === task?.libraryKey);
  const myAssignment = task?.annotators.find((a) => a.userPid === user?.pid);
  const editablePerspectives = myAssignment?.perspectives || [];

  const [filterStatus, setFilterStatus] = useState<AnnoStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<Set<string>>(new Set());
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [showRules, setShowRules] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<Perspective | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(typeof window !== "undefined" && window.innerWidth < 1280);

  const styleStatus = (sId: string): AnnoStatus => {
    if (!task) return "not_started";
    const annos = editablePerspectives.map((p) => db.annotations.find((a) => a.taskId === task.id && a.styleId === sId && a.perspective === p));
    if (annos.every((a) => !a)) return "not_started";
    if (annos.some((a) => a?.status === "rejected")) return "rejected";
    if (annos.some((a) => a?.status === "submitted")) return "submitted";
    if (annos.some((a) => a?.status === "approved") && annos.every((a) => !a || a.status === "approved")) return "approved";
    if (annos.some((a) => a?.status === "drafted")) return "drafted";
    return "not_started";
  };

  const styles = useMemo(() => {
    if (!dataset) return [];
    return dataset.styles.filter((s) => {
      if (search && !s.styleId.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterStatus !== "all" && styleStatus(s.id) !== filterStatus) return false;
      return true;
    });
  }, [dataset, search, filterStatus, db.annotations]);

  // Default selected style
  useEffect(() => {
    if (!activeStyleId && styles.length > 0) setActiveStyleId(styles[0].id);
    if (activeStyleId && !styles.find((s) => s.id === activeStyleId) && styles.length > 0) setActiveStyleId(styles[0].id);
  }, [styles, activeStyleId]);

  const activeStyle = dataset?.styles.find((s) => s.id === activeStyleId);

  // Load drafts when style changes
  useEffect(() => {
    if (!activeStyle || !task) return;
    const next: DraftMap = {};
    PERSPECTIVES.forEach((p) => {
      const a = getAnnotation(task.id, activeStyle.id, p);
      const preselect = activeStyle.preselect?.[p];
      next[p] = a
        ? { data: a.data as Record<string, string[]>, craftPartGroups: a.craftPartGroups || [], relationGroups: a.relationGroups || [], customTags: a.customTags, dirty: false }
        : { data: preselect ? { ...preselect } : {}, craftPartGroups: [], relationGroups: [], customTags: [], dirty: !!preselect };
    });
    setDrafts(next);
    setImgIdx(0);
  }, [activeStyle?.id, task?.id]);

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
    if (!task || !activeStyle || !user) return;
    if (status === "submitted") {
      const err = validate();
      if (err) { toast.error(err); return; }
    }
    let count = 0;
    PERSPECTIVES.forEach((p) => {
      if (!editablePerspectives.includes(p)) return;
      const draft = drafts[p];
      if (!draft) return;
      const isEmpty = Object.keys(draft.data).length === 0 && draft.craftPartGroups.length === 0 && draft.relationGroups.length === 0 && draft.customTags.length === 0;
      if (status === "submitted" && isEmpty) return;
      if (status === "drafted" && isEmpty && !draft.dirty) return;
      const existing = getAnnotation(task.id, activeStyle.id, p);
      if (silent && existing && ["submitted", "approved"].includes(existing.status)) return;
      const a: Annotation = {
        id: existing?.id || uid(),
        taskId: task.id,
        styleId: activeStyle.id,
        perspective: p,
        status,
        data: draft.data,
        craftPartGroups: draft.craftPartGroups,
        relationGroups: draft.relationGroups,
        customTags: draft.customTags,
        annotatorPid: user.pid,
        reviewerNotes: existing?.reviewerNotes || [],
        history: [...(existing?.history || []), {
          ts: Date.now(), status, by: user.pid,
          data: draft.data, craftPartGroups: draft.craftPartGroups, relationGroups: draft.relationGroups, customTags: draft.customTags,
        }],
        updatedAt: Date.now(),
      };
      upsertAnnotation(a);
      count++;
    });
    if (count > 0) {
      log(status === "submitted" ? "submit_annotation" : "save_draft", user.pid, `task=${task.id} style=${activeStyle.styleId} n=${count}`);
      if (!silent) toast.success(status === "submitted" ? `已提交 ${count} 个视角` : `已保存草稿 ${count} 个视角`);
    }
  };

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    const t = setInterval(() => saveAll("drafted", true), 30000);
    return () => clearInterval(t);
  }, [activeStyle?.id, task?.id]);

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
    toast.success("AI 预标注完成（mock）");
  };

  const batchSubmit = () => {
    if (selectedStyles.size === 0) { toast.error("未选中款式"); return; }
    let total = 0;
    selectedStyles.forEach((sid) => {
      PERSPECTIVES.forEach((p) => {
        if (!editablePerspectives.includes(p)) return;
        const ex = getAnnotation(task.id, sid, p);
        if (ex && ex.status === "drafted") {
          ex.status = "submitted";
          ex.history.push({ ts: Date.now(), status: "submitted", by: user.pid, data: ex.data, craftPartGroups: ex.craftPartGroups, customTags: ex.customTags });
          ex.updatedAt = Date.now();
          upsertAnnotation(ex);
          total++;
        }
      });
    });
    log("batch_submit", user.pid, `task=${task.id} styles=${selectedStyles.size} versions=${total}`);
    toast.success(`批量提交 ${total} 个视角`);
    setSelectedStyles(new Set());
  };

  const restoreVersion = (p: Perspective, ver: any) => {
    if (!confirm("确认恢复此版本至草稿？当前未保存改动会丢失。")) return;
    setDrafts((prev) => ({
      ...prev,
      [p]: {
        data: ver.data || {},
        craftPartGroups: ver.craftPartGroups || [],
        relationGroups: ver.relationGroups || [],
        customTags: ver.customTags || [],
        dirty: true,
      },
    }));
    log("restore_version", user.pid, `style=${activeStyle?.styleId} persp=${p} ts=${ver.ts}`);
    toast.success("已恢复，请保存草稿");
    setHistoryOpen(null);
  };

  const isComment = library.key === "comment";

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="border-b px-4 py-2 flex items-center gap-3 bg-card flex-wrap">
        <Link to="/annotator" className="text-sm text-primary">← 返回</Link>
        <div className="font-semibold">{task.name}</div>
        <span className="text-xs px-2 py-0.5 rounded bg-muted">任务包：{dataset.name}</span>
        {(() => {
          const total = dataset.styles.length;
          const done = dataset.styles.filter((s) => {
            const st = styleStatus(s.id);
            return st === "approved" || st === "submitted";
          }).length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <div className="flex items-center gap-2 text-xs">
              <div className="w-32 h-1.5 rounded bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
              </div>
              <span>{done}/{total} ({pct}%)</span>
            </div>
          );
        })()}
        <div className="ml-auto text-xs text-muted-foreground">Ctrl+S 草稿 · Ctrl+Enter 提交 · 30s 自动保存</div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: style list (collapsible) */}
        <div className={`${leftCollapsed ? "w-10" : "w-[280px]"} border-r bg-card flex flex-col transition-all relative shrink-0`}>
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="absolute -right-3 top-3 z-10 bg-card border rounded-full w-6 h-6 flex items-center justify-center hover:bg-muted shadow-sm">
            {leftCollapsed ? <PanelLeftOpen className="w-3 h-3" /> : <PanelLeftClose className="w-3 h-3" />}
          </button>
          {leftCollapsed ? (
            <div className="flex-1 flex flex-col items-center pt-4 gap-2 text-[10px] text-muted-foreground">
              <span className="rotate-90 whitespace-nowrap mt-8">款式列表 ({styles.length})</span>
            </div>
          ) : (
            <>
              <div className="p-2 border-b space-y-2">
                <Input placeholder="搜索款式ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
                <div className="flex flex-wrap gap-1">
                  {STATUSES.map((s) => (
                    <button key={s.key} onClick={() => setFilterStatus(s.key)}
                      className={`text-xs px-2 py-0.5 rounded ${filterStatus === s.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
                {selectedStyles.size > 0 && (
                  <div className="flex gap-1 items-center">
                    <span className="text-xs">已选 {selectedStyles.size}</span>
                    <Button size="sm" className="h-6 text-xs" onClick={batchSubmit}>批量提交</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setSelectedStyles(new Set())}>清空</Button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                {styles.map((s) => {
                  const st = styleStatus(s.id);
                  const tagSummary: string[] = [];
                  editablePerspectives.forEach((p) => {
                    const a = db.annotations.find((x) => x.taskId === task.id && x.styleId === s.id && x.perspective === p);
                    if (a) Object.values(a.data).forEach((v) => (Array.isArray(v) ? v : [v]).forEach((vv) => vv && tagSummary.push(vv as string)));
                  });
                  return (
                    <div key={s.id}
                      onClick={() => setActiveStyleId(s.id)}
                      className={`p-2 border-b cursor-pointer flex gap-2 ${activeStyleId === s.id ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/50"}`}>
                      <input type="checkbox" className="mt-1" checked={selectedStyles.has(s.id)} onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const set = new Set(selectedStyles);
                          if (e.target.checked) set.add(s.id); else set.delete(s.id);
                          setSelectedStyles(set);
                        }} />
                      {s.images[0] ? <img src={s.images[0].url} className="w-12 h-12 object-cover rounded" alt="" /> : <div className="w-12 h-12 bg-muted rounded" />}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{s.styleId}</div>
                        <div className="text-[10px] text-muted-foreground">{s.images.length} 图 · <StatusBadge s={st} /></div>
                        <div className="text-[10px] truncate text-muted-foreground">{[...new Set(tagSummary)].slice(0, 3).join(" · ") || "无标签"}</div>
                      </div>
                    </div>
                  );
                })}
                {styles.length === 0 && <div className="text-sm text-muted-foreground p-4">无符合的款式</div>}
              </div>
            </>
          )}
        </div>

        {/* Middle: image + perspectives split */}
        <div className="flex-1 overflow-hidden flex">
          {!activeStyle ? (
            <div className="p-6 text-muted-foreground">请从左侧选择一个款式</div>
          ) : (
            <>
              {/* Image column */}
              <div className="w-[35%] min-w-[280px] border-r overflow-auto p-4 bg-background">
                <Card className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="font-bold">{activeStyle.styleId}</div>
                    <span className="text-xs text-muted-foreground">{activeStyle.images.length} 图</span>
                  </div>
                  {isComment ? (
                    <textarea placeholder="客户评语文本…" className="border rounded p-2 text-sm w-full h-32 bg-background" />
                  ) : activeStyle.images.length > 0 ? (
                    <>
                      <img src={activeStyle.images[imgIdx]?.url} alt=""
                        className="w-full aspect-square object-contain bg-muted rounded mb-2 cursor-zoom-in"
                        onClick={() => window.open(activeStyle.images[imgIdx]?.url, "_blank")} />
                      <div className="flex gap-1 flex-wrap">
                        {activeStyle.images.map((im, i) => (
                          <button key={i} onClick={() => setImgIdx(i)}
                            className={`border rounded p-0.5 ${imgIdx === i ? "border-primary ring-2 ring-primary/30" : ""}`}>
                            <img src={im.url} className="w-14 h-14 object-cover rounded" alt="" />
                            <div className="text-[10px] mt-0.5 text-center">{im.angle || `图${i + 1}`}</div>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-muted-foreground text-sm">暂无图片</div>
                  )}
                </Card>
              </div>

              {/* Form column */}
              <div className="flex-1 overflow-auto p-4 space-y-3">
                {PERSPECTIVES.map((p) => {
                  const existing = getAnnotation(task.id, activeStyle.id, p);
                  const lockedByApproval = existing?.status === "approved";
                  const editable = editablePerspectives.includes(p) && !lockedByApproval;
                  const draft = drafts[p] || emptyDraft();
                  return (
                    <Card key={p} className={`p-4 ${editable ? "border-primary/30" : "bg-muted/40"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        {editable ? <Pencil className="w-4 h-4 text-primary" /> : <Lock className="w-4 h-4 text-muted-foreground" />}
                        <h3 className="font-semibold">{PERSPECTIVE_LABEL[p]}</h3>
                        {existing && <StatusBadge s={existing.status} />}
                        {lockedByApproval && <span className="text-[10px] text-success">已通过 · 只读</span>}
                        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={() => setHistoryOpen(p)}>
                          <History className="w-3 h-3" /> 历史 ({existing?.history.length || 0})
                        </Button>
                      </div>
                      {existing?.rejectReason && (
                        <div className="text-xs text-destructive bg-destructive/10 p-2 rounded mb-2">打回原因：{existing.rejectReason}</div>
                      )}
                      <PerspectiveForm library={library} draft={draft} editable={editable} onChange={(fn) => updateDraft(p, fn)} />
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right helper panel (collapsible) */}
        <div className={`${rightCollapsed ? "w-10" : "w-64"} border-l bg-card overflow-auto transition-all relative shrink-0`}>
          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="absolute -left-3 top-3 z-10 bg-card border rounded-full w-6 h-6 flex items-center justify-center hover:bg-muted shadow-sm">
            {rightCollapsed ? <PanelRightOpen className="w-3 h-3" /> : <PanelRightClose className="w-3 h-3" />}
          </button>
          {rightCollapsed ? (
            <div className="flex flex-col items-center pt-4 gap-3">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              <span className="rotate-90 text-[10px] text-muted-foreground whitespace-nowrap mt-6">辅助面板</span>
            </div>
          ) : (
            <div className="p-3 space-y-3 text-sm">
              <Button size="sm" variant="outline" className="w-full" onClick={() => setShowRules(true)}>
                <BookOpen className="w-3 h-3" /> 标注规范
              </Button>
              <div>
                <div className="font-medium mb-1">参考图库</div>
                <div className="grid grid-cols-2 gap-1">
                  {dataset.styles.filter((s) => s.id !== activeStyle?.id).slice(0, 4).flatMap((s) => s.images.slice(0, 1)).map((im, i) => (
                    <img key={i} src={im.url} className="w-full h-16 object-cover rounded cursor-zoom-in" onClick={() => window.open(im.url, "_blank")} alt="" />
                  ))}
                </div>
              </div>
              <div>
                <div className="font-medium mb-1">本款式自定义标签</div>
                <div className="flex flex-wrap gap-1">
                  {Object.values(drafts).flatMap((d) => d?.customTags || []).map((t, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded bg-accent/30">{t}</span>
                  ))}
                </div>
              </div>
              {library.guidelines ? (
                <div>
                  <div className="font-medium mb-1 flex items-center gap-1"><BookOpen className="w-3 h-3" />库标注规范</div>
                  <div className="text-xs whitespace-pre-wrap text-muted-foreground bg-muted/40 rounded p-2 max-h-64 overflow-auto">{library.guidelines}</div>
                </div>
              ) : (
                <div>
                  <div className="font-medium mb-1 flex items-center gap-1"><BookOpen className="w-3 h-3" />库标注规范</div>
                  <div className="text-xs text-muted-foreground">暂无标注规范</div>
                </div>
              )}
              {(library.relations || []).length > 0 && (
                <div>
                  <div className="font-medium mb-1">字段关联参考</div>
                  <div className="text-xs space-y-1 text-muted-foreground">
                    {(library.relations || []).map((r) => {
                      const ff = library.fields.find((f) => f.key === r.fromField);
                      const tf = library.fields.find((f) => f.key === r.toField);
                      return (
                        <div key={r.relationId}>
                          <b className="text-foreground">{ff?.label || r.fromField} → {tf?.label || r.toField}</b>
                          <div className="pl-2 space-y-0.5">
                            {Object.entries(r.mapping).slice(0, 6).map(([k, vs]) => (
                              <div key={k}><span className="text-foreground">{k}</span>: {(vs as string[]).join(", ")}</div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t px-4 py-3 flex gap-2 justify-end bg-card flex-wrap">
        <Button variant="outline" size="sm" onClick={aiPreLabel}><Sparkles className="w-3 h-3" />AI 预标注</Button>
        <Button variant="outline" size="sm" onClick={() => saveAll("drafted")}>保存草稿</Button>
        <Button size="sm" onClick={() => saveAll("submitted")}>提交</Button>
      </div>

      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent>
          <DialogHeader><DialogTitle>📘 标注规范</DialogTitle></DialogHeader>
          <div className="text-sm space-y-2 max-h-96 overflow-auto">
            <p>1. 每个款式包含多张图片（正面/背面/细节），所有视角共享一份标注。</p>
            <p>2. 工艺-部位组：每个工艺允许的部位由库管理员维护。</p>
            <p>3. 自定义标签：仅在固定选项无法描述时使用，提交后进入审核流程。</p>
            <p>4. 字段联动：依赖字段（如品类）的变化会刷新关联字段（如领型）的可选项。</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyOpen} onOpenChange={(o) => !o && setHistoryOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>历史版本 - {historyOpen && PERSPECTIVE_LABEL[historyOpen]}</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-96 overflow-auto">
            {historyOpen && activeStyle && (() => {
              const a = getAnnotation(task.id, activeStyle.id, historyOpen);
              if (!a || a.history.length === 0) return <div className="text-muted-foreground text-sm">暂无历史</div>;
              return a.history.slice().reverse().map((h, i, arr) => {
                const prev = arr[i + 1];
                const diff: string[] = [];
                if (prev && h.data && prev.data) {
                  Object.keys({ ...h.data, ...prev.data }).forEach((k) => {
                    const a1 = JSON.stringify(h.data?.[k]); const a2 = JSON.stringify(prev.data?.[k]);
                    if (a1 !== a2) diff.push(`${k}: ${a2 || "∅"} → ${a1 || "∅"}`);
                  });
                }
                return (
                  <div key={i} className="border rounded p-2 text-xs">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-medium">{new Date(h.ts).toLocaleString()}</span>
                        <span className="ml-2">[{h.status}]</span>
                        <span className="ml-2 text-muted-foreground">by {h.by}</span>
                      </div>
                      <Button size="sm" variant="outline" className="h-6" onClick={() => restoreVersion(historyOpen, h)}>
                        <RotateCcw className="w-3 h-3" />恢复
                      </Button>
                    </div>
                    {h.reason && <div className="text-destructive">原因：{h.reason}</div>}
                    {diff.length > 0 && <div className="mt-1 text-muted-foreground">变更：{diff.slice(0, 5).join("; ")}</div>}
                    <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">完整数据</summary>
                      <pre className="mt-1 bg-muted p-1 rounded">{JSON.stringify(h.data, null, 2)}</pre></details>
                  </div>
                );
              });
            })()}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setHistoryOpen(null)}>关闭</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ s }: { s: AnnoStatus }) {
  const map: Record<AnnoStatus, string> = {
    not_started: "bg-muted text-muted-foreground",
    drafted: "bg-amber-100 text-amber-900",
    submitted: "bg-blue-100 text-blue-900",
    approved: "bg-green-100 text-green-900",
    rejected: "bg-red-100 text-red-900",
  };
  const lab: Record<AnnoStatus, string> = { not_started: "未打标", drafted: "草稿", submitted: "待审核", approved: "已通过", rejected: "已打回" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${map[s]}`}>{lab[s]}</span>;
}

function PerspectiveForm({
  library, draft, editable, onChange,
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
  const setText = (fk: string, val: string) => onChange((d) => ({ ...d, data: { ...d.data, [fk]: [val] } }));

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
                    const published = rule && rule.status === "published" ? rule : undefined;
                    return (
                      <div key={opt} className="flex items-center">
                        <button disabled={!editable} onClick={() => toggleOption(f.key, opt)}
                          className={`px-3 py-1 rounded-l-full border text-xs flex items-center gap-1 ${
                            selected.includes(opt) ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
                          } ${!editable ? "opacity-70 cursor-not-allowed" : ""}`}>
                          {opt}
                        </button>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="px-1.5 py-1 rounded-r-full border border-l-0 hover:bg-muted" title="规则">
                              <HelpCircle className="w-3 h-3 opacity-60" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 text-xs space-y-1.5">
                            <div className="font-semibold">{opt} {published ? <span className="text-[10px] text-primary ml-1">[已发布]</span> : <span className="text-[10px] text-muted-foreground ml-1">[暂无规则]</span>}</div>
                            {published ? (
                              <>
                                <div><b>定义：</b>{published.definition || "—"}</div>
                                <div><b>判断标准：</b>{published.criteria || "—"}</div>
                                {published.exclusive?.length > 0 && <div><b>互斥：</b>{published.exclusive.join(", ")}</div>}
                                {published.dependency && <div><b>依赖：</b>{published.dependency}</div>}
                                {published.notRecommended && <div className="text-destructive">⚠ 默认不推荐</div>}
                                {published.positiveImages?.length > 0 && (
                                  <div className="flex gap-1 flex-wrap pt-1">
                                    {published.positiveImages.map((u, i) => <img key={i} src={u} className="w-14 h-14 object-cover rounded" alt="" />)}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-muted-foreground">该标签尚未配置规则</div>
                            )}
                          </PopoverContent>
                        </Popover>
                      </div>
                    );
                  })}
                </div>
                {f.allowCustom && editable && (
                  <div className="flex gap-2 mt-2">
                    <Input placeholder="新自定义标签" value={customInputs[f.key] || ""}
                      onChange={(e) => setCustomInputs((p) => ({ ...p, [f.key]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustom(f.key))}
                      className="h-8" />
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
                    <select disabled={!editable} className="border rounded px-2 py-1 text-sm bg-background" value={g.craft}
                      onChange={(e) => onChange((d) => {
                        const arr = [...d.craftPartGroups];
                        arr[gi] = { craft: e.target.value, parts: [] };
                        return { ...d, craftPartGroups: arr };
                      })}>
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
                      <button key={p} disabled={!editable}
                        onClick={() => onChange((d) => {
                          const arr = [...d.craftPartGroups];
                          const cur = arr[gi].parts;
                          arr[gi] = { ...arr[gi], parts: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] };
                          return { ...d, craftPartGroups: arr };
                        })}
                        className={`px-2 py-1 rounded border text-xs ${g.parts.includes(p) ? "bg-accent text-accent-foreground border-accent" : ""}`}>
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
