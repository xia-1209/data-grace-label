import { useEffect, useMemo, useState } from "react";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AnnoStatus, Annotation, PERSPECTIVES, PERSPECTIVE_LABEL, Perspective,
  log, loadDB, saveDB, uid,
} from "@/lib/store";
import { toast } from "sonner";

type ReviewFilter = "submitted" | "approved" | "rejected" | "all";
const FILTERS: { key: ReviewFilter; label: string }[] = [
  { key: "submitted", label: "待审核" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已打回" },
  { key: "all", label: "全部" },
];

export default function Reviewer() {
  const db = useDB();
  const { user } = useAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  if (!user) return null;
  const myTasks = db.tasks.filter((t) => t.reviewers.includes(user.pid));
  const task = myTasks.find((t) => t.id === taskId);

  if (!task) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">待审核任务</h1>
          <Input placeholder="搜索任务…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {myTasks.filter((t) => t.name.toLowerCase().includes(search.toLowerCase())).map((t) => {
            const ds = db.datasets.find((d) => d.id === t.datasetId);
            const pending = db.annotations.filter((a) => a.taskId === t.id && a.status === "submitted").length;
            const approved = db.annotations.filter((a) => a.taskId === t.id && a.status === "approved").length;
            const rejected = db.annotations.filter((a) => a.taskId === t.id && a.status === "rejected").length;
            return (
              <Card key={t.id} className="p-4 space-y-2">
                <h3 className="font-semibold">{t.name}</h3>
                <div className="text-xs text-muted-foreground">任务包：{ds?.name} · {ds?.styles.length || 0} 个款式</div>
                <div className="flex gap-3 text-xs">
                  <span className="text-blue-700">待审核 {pending}</span>
                  <span className="text-green-700">通过 {approved}</span>
                  <span className="text-red-700">打回 {rejected}</span>
                </div>
                <Button size="sm" onClick={() => setTaskId(t.id)}>进入审核</Button>
              </Card>
            );
          })}
          {myTasks.length === 0 && <p className="text-muted-foreground">暂无任务</p>}
        </div>
      </div>
    );
  }

  return <ReviewerWorkbench taskId={task.id} onExit={() => setTaskId(null)} />;
}

function ReviewerWorkbench({ taskId, onExit }: { taskId: string; onExit: () => void }) {
  const db = useDB();
  const { user } = useAuth();
  const task = db.tasks.find((t) => t.id === taskId)!;
  const dataset = db.datasets.find((d) => d.id === task.datasetId)!;
  const library = db.libraries.find((l) => l.key === task.libraryKey)!;

  const [filter, setFilter] = useState<ReviewFilter>("submitted");
  const [search, setSearch] = useState("");
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<Record<Perspective, Record<string, string[]>>>({} as any);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const styleStatusOf = (sId: string): AnnoStatus | "mixed" => {
    const annos = PERSPECTIVES.map((p) => db.annotations.find((a) => a.taskId === task.id && a.styleId === sId && a.perspective === p)).filter(Boolean) as Annotation[];
    if (annos.length === 0) return "not_started";
    if (annos.some((a) => a.status === "submitted")) return "submitted";
    if (annos.every((a) => a.status === "approved")) return "approved";
    if (annos.some((a) => a.status === "rejected")) return "rejected";
    return "mixed" as any;
  };

  const styles = useMemo(() => {
    return dataset.styles.filter((s) => {
      if (search && !s.styleId.toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "all") return true;
      const annos = PERSPECTIVES.map((p) => db.annotations.find((a) => a.taskId === task.id && a.styleId === s.id && a.perspective === p)).filter(Boolean) as Annotation[];
      return annos.some((a) => a.status === filter);
    });
  }, [dataset, db.annotations, filter, search, task.id]);

  useEffect(() => {
    if (!activeStyleId && styles.length > 0) setActiveStyleId(styles[0].id);
    if (activeStyleId && !styles.find((s) => s.id === activeStyleId) && styles.length > 0) setActiveStyleId(styles[0].id);
  }, [styles, activeStyleId]);

  const activeStyle = dataset.styles.find((s) => s.id === activeStyleId);

  // load edit draft when style/edit toggled
  useEffect(() => {
    if (!editMode || !activeStyle) return;
    const next: any = {};
    PERSPECTIVES.forEach((p) => {
      const a = db.annotations.find((x) => x.taskId === task.id && x.styleId === activeStyle.id && x.perspective === p);
      next[p] = a ? { ...(a.data as Record<string, string[]>) } : {};
    });
    setEditDraft(next);
  }, [editMode, activeStyle?.id]);

  useEffect(() => { setImgIdx(0); setEditMode(false); }, [activeStyle?.id]);

  const setStatus = (annoId: string, status: "approved" | "rejected", reason?: string) => {
    if (!user) return;
    const x = loadDB();
    const i = x.annotations.findIndex((a) => a.id === annoId);
    if (i < 0) return;
    x.annotations[i].status = status;
    x.annotations[i].reviewerPid = user.pid;
    if (status === "rejected") x.annotations[i].rejectReason = reason || "";
    x.annotations[i].history.push({ ts: Date.now(), status, by: user.pid, reason });
    x.annotations[i].updatedAt = Date.now();
    saveDB(x);
    log(status === "approved" ? "review_approve" : "review_reject", user.pid, `style=${x.annotations[i].styleId} persp=${x.annotations[i].perspective}`);
  };

  const reviewAll = (status: "approved" | "rejected") => {
    if (!activeStyle) return;
    let reason = "";
    if (status === "rejected") {
      reason = prompt("打回原因") || "";
      if (!reason) return;
    }
    PERSPECTIVES.forEach((p) => {
      const a = db.annotations.find((x) => x.taskId === task.id && x.styleId === activeStyle.id && x.perspective === p);
      if (a && a.status === "submitted") setStatus(a.id, status, reason);
    });
    toast.success(status === "approved" ? "已通过" : "已打回");
  };

  const batchReview = (status: "approved" | "rejected") => {
    if (selected.size === 0) return;
    let reason = "";
    if (status === "rejected") {
      reason = prompt(`批量打回 ${selected.size} 个款式，请输入原因`) || "";
      if (!reason) return;
    }
    let n = 0;
    selected.forEach((sid) => {
      PERSPECTIVES.forEach((p) => {
        const a = db.annotations.find((x) => x.taskId === task.id && x.styleId === sid && x.perspective === p);
        if (a && a.status === "submitted") { setStatus(a.id, status, reason); n++; }
      });
    });
    toast.success(`批量${status === "approved" ? "通过" : "打回"} ${n} 条`);
    setSelected(new Set());
  };

  const saveEdits = () => {
    if (!activeStyle || !user) return;
    const x = loadDB();
    let n = 0;
    PERSPECTIVES.forEach((p) => {
      const draft = editDraft[p];
      if (!draft) return;
      const i = x.annotations.findIndex((a) => a.taskId === task.id && a.styleId === activeStyle.id && a.perspective === p);
      if (i < 0) return;
      const prev = x.annotations[i];
      const changed = JSON.stringify(prev.data) !== JSON.stringify(draft);
      if (!changed) return;
      x.annotations[i] = {
        ...prev,
        data: draft,
        status: "submitted", // 已修改-需复审，保留 submitted 待二审
        reviewerPid: user.pid,
        updatedAt: Date.now(),
        history: [...prev.history, { ts: Date.now(), status: "submitted", by: user.pid, reason: "审核员编辑", data: draft, craftPartGroups: prev.craftPartGroups, customTags: prev.customTags }],
      };
      n++;
    });
    saveDB(x);
    log("reviewer_edit", user.pid, `style=${activeStyle.styleId} count=${n}`);
    toast.success(`已修改 ${n} 个视角，状态变更为"已修改-需复审"`);
    setEditMode(false);
  };

  // diff: latest version vs previous-of-same-perspective
  const diffOf = (a: Annotation): Record<string, [any, any]> => {
    const out: Record<string, [any, any]> = {};
    const prevVer = [...a.history].reverse().find((h, idx) => idx > 0 && h.data) || null;
    const cur = a.data;
    const prev = prevVer?.data || {};
    new Set([...Object.keys(cur), ...Object.keys(prev)]).forEach((k) => {
      const c = JSON.stringify(cur[k] ?? null), p = JSON.stringify(prev[k] ?? null);
      if (c !== p) out[k] = [prev[k], cur[k]];
    });
    return out;
  };

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="border-b px-4 py-2 flex items-center gap-3 bg-card flex-wrap">
        <Button variant="ghost" size="sm" onClick={onExit}>← 返回</Button>
        <div className="font-semibold">{task.name}</div>
        <span className="text-xs px-2 py-0.5 rounded bg-muted">任务包：{dataset.name}</span>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs">已选 {selected.size}</span>
            <Button size="sm" onClick={() => batchReview("approved")}>批量通过</Button>
            <Button size="sm" variant="destructive" onClick={() => batchReview("rejected")}>批量打回</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清空</Button>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* left list */}
        <div className="w-[320px] border-r bg-card flex flex-col">
          <div className="p-2 border-b space-y-2">
            <Input placeholder="搜索款式ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8" />
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`text-xs px-2 py-0.5 rounded ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {styles.map((s) => {
              const st = styleStatusOf(s.id);
              return (
                <div key={s.id} onClick={() => setActiveStyleId(s.id)}
                  className={`p-2 border-b cursor-pointer flex gap-2 ${activeStyleId === s.id ? "bg-primary/10 border-l-4 border-l-primary" : "hover:bg-muted/50"}`}>
                  <input type="checkbox" className="mt-1" checked={selected.has(s.id)} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const ns = new Set(selected);
                      if (e.target.checked) ns.add(s.id); else ns.delete(s.id);
                      setSelected(ns);
                    }} />
                  {s.images[0] ? <img src={s.images[0].url} className="w-12 h-12 object-cover rounded" alt="" /> : <div className="w-12 h-12 bg-muted rounded" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{s.styleId}</div>
                    <div className="text-[10px] text-muted-foreground">{s.images.length} 图</div>
                    <div className="text-[10px]"><StatusBadge s={st as AnnoStatus} /></div>
                  </div>
                </div>
              );
            })}
            {styles.length === 0 && <div className="text-sm text-muted-foreground p-4">无符合的款式</div>}
          </div>
        </div>

        {/* main */}
        <div className="flex-1 overflow-auto">
          {!activeStyle ? (
            <div className="p-6 text-muted-foreground">请从左侧选择一个款式</div>
          ) : (
            <div className="p-4 space-y-4">
              <Card className="p-3">
                <div className="flex items-center gap-3 mb-2">
                  <div className="font-bold text-lg">{activeStyle.styleId}</div>
                  <span className="text-xs text-muted-foreground">{activeStyle.images.length} 张图片</span>
                  <div className="ml-auto flex gap-2">
                    {!editMode ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>进入编辑模式</Button>
                        <Button size="sm" variant="destructive" onClick={() => reviewAll("rejected")}>整款打回</Button>
                        <Button size="sm" onClick={() => reviewAll("approved")}>整款通过</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>取消</Button>
                        <Button size="sm" onClick={saveEdits}>保存修改并标记需复审</Button>
                      </>
                    )}
                  </div>
                </div>
                {activeStyle.images.length > 0 && (
                  <div className="flex gap-3">
                    <img src={activeStyle.images[imgIdx]?.url} className="w-72 h-72 object-contain bg-muted rounded" alt="" />
                    <div className="flex flex-col gap-1 overflow-auto max-h-72">
                      {activeStyle.images.map((im, i) => (
                        <button key={i} onClick={() => setImgIdx(i)}
                          className={`border rounded p-1 ${imgIdx === i ? "border-primary ring-2 ring-primary/30" : ""}`}>
                          <img src={im.url} className="w-16 h-16 object-cover rounded" alt="" />
                          <div className="text-[10px] mt-0.5 text-center">{im.angle || `图${i + 1}`}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Card>

              {PERSPECTIVES.map((p) => {
                const a = db.annotations.find((x) => x.taskId === task.id && x.styleId === activeStyle.id && x.perspective === p);
                if (!a) return (
                  <Card key={p} className="p-3 bg-muted/40">
                    <div className="font-semibold text-sm">{PERSPECTIVE_LABEL[p]}</div>
                    <div className="text-xs text-muted-foreground">无标注</div>
                  </Card>
                );
                const diff = diffOf(a);
                return (
                  <Card key={p} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold text-sm">{PERSPECTIVE_LABEL[p]}</h3>
                      <StatusBadge s={a.status} />
                      {a.status === "submitted" && !editMode && (
                        <div className="ml-auto flex gap-1">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => {
                            const r = prompt("打回原因"); if (r) { setStatus(a.id, "rejected", r); toast.success("已打回"); }
                          }}>打回</Button>
                          <Button size="sm" className="h-7" onClick={() => { setStatus(a.id, "approved"); toast.success("已通过"); }}>通过</Button>
                        </div>
                      )}
                    </div>
                    {a.rejectReason && <div className="text-xs text-destructive mb-2">打回原因：{a.rejectReason}</div>}

                    {editMode ? (
                      <div className="space-y-2">
                        {library.fields.map((f) => {
                          const cur = editDraft[p]?.[f.key] || [];
                          if (f.type === "text") {
                            return (
                              <div key={f.key}>
                                <div className="text-xs font-medium mb-1">{f.label}</div>
                                <Input value={cur[0] || ""} onChange={(e) => setEditDraft((prev) => ({ ...prev, [p]: { ...prev[p], [f.key]: [e.target.value] } }))} className="h-8" />
                              </div>
                            );
                          }
                          return (
                            <div key={f.key}>
                              <div className="text-xs font-medium mb-1">{f.label}</div>
                              <div className="flex flex-wrap gap-1">
                                {[...new Set([...f.options, ...cur])].map((opt) => {
                                  const sel = cur.includes(opt);
                                  return (
                                    <button key={opt} onClick={() => setEditDraft((prev) => {
                                      const c = prev[p]?.[f.key] || [];
                                      const next = c.includes(opt) ? c.filter((x) => x !== opt) : [...c, opt];
                                      return { ...prev, [p]: { ...prev[p], [f.key]: next } };
                                    })}
                                      className={`text-xs px-2 py-0.5 rounded border ${sel ? "bg-primary text-primary-foreground" : "bg-background"}`}>
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {library.fields.map((f) => {
                          const vals = (a.data[f.key] as string[]) || [];
                          if (vals.length === 0 && !diff[f.key]) return null;
                          const changed = !!diff[f.key];
                          return (
                            <div key={f.key} className={`text-xs px-2 py-1 rounded ${changed ? "bg-amber-100 border border-amber-300" : ""}`}>
                              <span className="font-medium text-foreground">{f.label}：</span>
                              <span>{Array.isArray(vals) ? vals.join(", ") : vals}</span>
                              {changed && diff[f.key][0] && (
                                <span className="ml-2 text-muted-foreground line-through">原：{(diff[f.key][0] as string[]).join(", ")}</span>
                              )}
                            </div>
                          );
                        })}
                        {a.craftPartGroups && a.craftPartGroups.length > 0 && (
                          <div className="text-xs text-muted-foreground">工艺-部位：{a.craftPartGroups.map((g) => `${g.craft}[${g.parts.join("/")}]`).join("; ")}</div>
                        )}
                        {a.customTags && a.customTags.length > 0 && (
                          <div className="text-xs">自定义标签：{a.customTags.join(", ")}</div>
                        )}
                      </div>
                    )}
                    {a.reviewerNotes && a.reviewerNotes.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2">内部备注：{a.reviewerNotes.join(" | ")}</div>
                    )}
                    {a.status === "submitted" && !editMode && (
                      <div className="mt-2">
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => {
                          const note = prompt("内部备注（不发给标注员）"); if (!note) return;
                          const x = loadDB(); const i = x.annotations.findIndex((xx) => xx.id === a.id);
                          if (i >= 0) { x.annotations[i].reviewerNotes = [...(x.annotations[i].reviewerNotes || []), note]; saveDB(x); toast.success("备注已添加"); }
                        }}>+ 添加内部备注</Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ s }: { s: AnnoStatus }) {
  const map: Record<string, string> = {
    not_started: "bg-muted text-muted-foreground",
    drafted: "bg-amber-100 text-amber-900",
    submitted: "bg-blue-100 text-blue-900",
    approved: "bg-green-100 text-green-900",
    rejected: "bg-red-100 text-red-900",
    mixed: "bg-purple-100 text-purple-900",
  };
  const lab: Record<string, string> = { not_started: "未标注", drafted: "草稿", submitted: "待审核", approved: "已通过", rejected: "已打回", mixed: "混合" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${map[s] || ""}`}>{lab[s] || s}</span>;
}
