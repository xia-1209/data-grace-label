import { useMemo, useState } from "react";
import { useDB } from "@/lib/useDB";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PERSPECTIVES, PERSPECTIVE_LABEL, Perspective, Role, log, loadDB, saveDB, uid, resetDemo } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const COLORS = ["#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#10b981"];

export function AdminDashboard() {
  const db = useDB();
  const totalTasks = db.tasks.length;
  const totalStyles = db.datasets.reduce((n, d) => n + d.styles.length, 0);
  const totalAnnotators = db.users.filter((u) => u.roles.includes("annotator")).length;
  const submittedOrApproved = db.annotations.filter((a) => ["submitted", "approved"].includes(a.status)).length;
  const totalSlots = db.tasks.reduce((n, t) => {
    const ds = db.datasets.find((d) => d.id === t.datasetId);
    const persSet = new Set<string>();
    t.annotators.forEach((a) => a.perspectives.forEach((p) => persSet.add(p)));
    return n + (ds?.styles.length || 0) * persSet.size;
  }, 0);
  const completionRate = totalSlots ? Math.round((submittedOrApproved / totalSlots) * 100) : 0;

  // 7-day submit trend
  const trend = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.now() - (6 - i) * 86400000);
    const ds = day.toISOString().slice(0, 10);
    const c = db.annotations.filter((a) =>
      a.history.some((h) => h.status === "submitted" && new Date(h.ts).toISOString().slice(0, 10) === ds)
    ).length || db.annotations.filter((a) => new Date(a.updatedAt).toISOString().slice(0, 10) === ds).length;
    return { day: ds.slice(5), count: c };
  });

  // Reject rate per task
  const rejectByTask = db.tasks.map((t) => {
    const subs = db.annotations.filter((a) => a.taskId === t.id && ["submitted", "approved", "rejected"].includes(a.status)).length;
    const rej = db.annotations.filter((a) => a.taskId === t.id && a.status === "rejected").length;
    return { name: t.name.slice(0, 10), rate: subs ? Math.round((rej / subs) * 100) : 0 };
  });

  // Annotator workload
  const workload = db.users.filter((u) => u.role === "annotator").map((u) => ({
    name: u.username,
    count: db.annotations.filter((a) => a.annotatorPid === u.pid && ["submitted", "approved"].includes(a.status)).length,
  })).sort((a, b) => b.count - a.count);

  // Tag heatmap top10
  const tagDist: Record<string, number> = {};
  db.annotations.forEach((a) => {
    Object.values(a.data).forEach((vals) => {
      (Array.isArray(vals) ? vals : [vals]).forEach((v) => {
        if (v) tagDist[v as string] = (tagDist[v as string] || 0) + 1;
      });
    });
  });
  const topTags = Object.entries(tagDist).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value }));

  const restoreBackup = async (file: File) => {
    if (!confirm("恢复将覆盖所有当前数据，确认？")) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      localStorage.setItem("garment_anno_db_v2", JSON.stringify(data));
      window.dispatchEvent(new CustomEvent("db-updated"));
      log("backup_restore", "admin");
      toast.success("已恢复");
    } catch { toast.error("JSON 解析失败"); }
  };

  const filteredExport = () => {
    const tag = prompt("按标签值过滤导出（留空导出全部）") || "";
    const data = db.annotations.filter((a) =>
      !tag || Object.values(a.data).some((vs) => (Array.isArray(vs) ? vs : [vs]).includes(tag))
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    saveAs(blob, `annotations_export.json`);
    log("export_filtered", "admin", `tag=${tag}`);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={filteredExport}>过滤导出 JSON</Button>
          <Button size="sm" variant="outline" onClick={() => { adminBackupExport(); log("backup_export", "admin"); }}>导出全量备份</Button>
          <label className="inline-flex">
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && restoreBackup(e.target.files[0])} />
            <span className="cursor-pointer text-sm border rounded px-3 py-1.5 hover:bg-muted">恢复备份</span>
          </label>
          <Button size="sm" variant="destructive" onClick={() => { if (confirm("确定重置演示数据？")) { resetDemo(); toast.success("已重置"); } }}>重置演示数据</Button>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-3">
        <StatCard label="任务包总数" v={totalTasks} />
        <StatCard label="款式总数" v={totalStyles} />
        <StatCard label="标注员人数" v={totalAnnotators} />
        <StatCard label="完成率 %" v={completionRate} />
        <StatCard label="待审核" v={db.annotations.filter((a) => a.status === "submitted").length} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">近一周提交趋势</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend}>
              <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip />
              <Line dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">各任务包打回率 (%)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rejectByTask}>
              <XAxis dataKey="name" /><YAxis /><Tooltip />
              <Bar dataKey="rate" fill={COLORS[2]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">标注员工作量</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={workload}>
              <XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip />
              <Bar dataKey="count" fill={COLORS[0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Top10 标签使用频率</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={topTags} layout="vertical">
              <XAxis type="number" /><YAxis type="category" dataKey="name" width={70} /><Tooltip />
              <Bar dataKey="value" fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
const StatCard = ({ label, v }: { label: string; v: number }) => (
  <Card className="p-4"><div className="text-sm text-muted-foreground">{label}</div><div className="text-3xl font-bold">{v}</div></Card>
);

// ---------------- Datasets ----------------
export function AdminDatasets() {
  const db = useDB();
  const [editing, setEditing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const del = (id: string) => {
    if (!confirm("确认删除该数据集？关联任务和标注将级联删除。")) return;
    const x = loadDB();
    x.datasets = x.datasets.filter((d) => d.id !== id);
    x.tasks = x.tasks.filter((t) => t.datasetId !== id);
    x.annotations = x.annotations.filter((a) => !x.tasks.find((t) => t.id === a.taskId));
    saveDB(x);
    toast.success("已删除");
  };

  const exportZip = async (id: string) => {
    const ds = db.datasets.find((d) => d.id === id)!;
    const tasks = db.tasks.filter((t) => t.datasetId === id);
    const zip = new JSZip();
    const csv = ["style_id,image_url,angle"];
    ds.styles.forEach((s) => s.images.forEach((im) => csv.push(`${s.styleId},${im.url},${im.angle || ""}`)));
    zip.file("styles.csv", csv.join("\n"));
    zip.file("dataset.json", JSON.stringify(ds, null, 2));
    // labels: 仅导出已通过的最终标注
    const labels = ds.styles.map((s) => {
      const annos: Record<string, any> = {};
      PERSPECTIVES.forEach((p) => {
        const a = db.annotations.find((x) => tasks.find((t) => t.id === x.taskId) && x.styleId === s.id && x.perspective === p && x.status === "approved");
        if (a) annos[p] = { data: a.data, craftPartGroups: a.craftPartGroups, customTags: a.customTags };
      });
      return { style_id: s.styleId, images: s.images, annotations: annos };
    });
    zip.file("labels.json", JSON.stringify(labels, null, 2));
    const labelCsv = ["style_id,perspective,field,values"];
    labels.forEach((l) => Object.entries(l.annotations).forEach(([p, v]: any) => {
      Object.entries(v.data || {}).forEach(([fk, vals]: any) => {
        labelCsv.push(`${l.style_id},${p},${fk},"${(Array.isArray(vals) ? vals : [vals]).join("|")}"`);
      });
    }));
    zip.file("labels.csv", labelCsv.join("\n"));
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${ds.name}.zip`);
  };

  const exportAnnotations = (id: string) => {
    const ds = db.datasets.find((d) => d.id === id)!;
    const tasks = db.tasks.filter((t) => t.datasetId === id);
    const merged = ds.styles.map((s) => ({
      style: s,
      annotations: db.annotations.filter((a) => tasks.find((t) => t.id === a.taskId) && a.styleId === s.id),
    }));
    const blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
    saveAs(blob, `${ds.name}_annotations.json`);
  };

  if (viewing) {
    return <DatasetDetail id={viewing} onClose={() => setViewing(null)} exportZip={exportZip} exportAnnotations={exportAnnotations} />;
  }

  if (editing !== null) return <DatasetEditor id={editing} onClose={() => setEditing(null)} />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between mb-4">
        <h1 className="text-2xl font-bold">数据集管理</h1>
        <Button onClick={() => setEditing("__new")}>新建数据集</Button>
      </div>
      <div className="space-y-2">
        {db.datasets.map((d) => (
          <Card key={d.id} className="p-4 flex justify-between items-center">
            <div>
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-muted-foreground">{d.styles.length} 个款式 · {d.styles.reduce((n, s) => n + s.images.length, 0)} 张图 · 创建 {new Date(d.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setViewing(d.id)}>详情</Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(d.id)}>编辑</Button>
              <Button size="sm" variant="outline" onClick={() => exportZip(d.id)}>导出</Button>
              <Button size="sm" variant="destructive" onClick={() => del(d.id)}>删除</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DatasetEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDB();
  const isNew = id === "__new";
  const ex = db.datasets.find((d) => d.id === id);
  const [name, setName] = useState(ex?.name || "");
  const [desc, setDesc] = useState(ex?.description || "");
  const [styles, setStyles] = useState(ex?.styles || []);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const handleStylesCsv = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) { toast.error("表格为空"); return; }
      const headers = Object.keys(rows[0]);
      const missing: string[] = [];
      if (!headers.includes("style_id") && !headers.includes("款式ID")) missing.push("style_id");
      if (!headers.includes("image_url") && !headers.includes("图片URL")) missing.push("image_url");
      if (missing.length > 0) { toast.error(`缺少列：${missing.join(", ")}`); return; }
      const next = [...styles];
      let added = 0; const errors: string[] = [];
      rows.forEach((r, idx) => {
        const sid = String(r.style_id || r["款式ID"] || "").trim();
        const url = String(r.image_url || r["图片URL"] || "").trim();
        const angle = String(r.angle || r["角度"] || "").trim();
        if (!sid) { errors.push(`第 ${idx + 2} 行：缺少 style_id`); return; }
        if (!url) { errors.push(`第 ${idx + 2} 行：缺少 image_url`); return; }
        let s = next.find((ss) => ss.styleId === sid);
        if (!s) { s = { id: uid(), styleId: sid, images: [] }; next.push(s); }
        s.images.push({ url, angle: angle || undefined, filename: url.split("/").pop() });
        added++;
      });
      setStyles(next);
      if (errors.length > 0) toast.error(`成功 ${added} 行，失败 ${errors.length} 行：${errors.slice(0, 3).join("; ")}`);
      else toast.success(`成功导入 ${added} 行（共 ${next.length} 个款式）`);
    } catch (e: any) {
      toast.error(`解析失败：${e.message}`);
    } finally { setBusy(false); }
  };

  const handlePreselect = async (file: File) => {
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) { toast.error("表格为空"); return; }
      const headers = Object.keys(rows[0]);
      const missing: string[] = [];
      if (!headers.includes("style_id")) missing.push("style_id");
      if (!headers.includes("perspective")) missing.push("perspective");
      if (missing.length > 0) { toast.error(`缺少列：${missing.join(", ")}`); return; }
      const next = [...styles];
      let ok = 0; const errors: string[] = [];
      rows.forEach((r, idx) => {
        const sid = String(r.style_id);
        const persp = r.perspective;
        const target = next.find((s) => s.styleId === sid);
        if (!target) { errors.push(`第 ${idx + 2} 行：款式ID ${sid} 不存在`); return; }
        if (!["production_tob", "commercial_tob", "commercial_toc"].includes(persp)) {
          errors.push(`第 ${idx + 2} 行：perspective ${persp} 无效`); return;
        }
        target.preselect = target.preselect || {};
        const obj: Record<string, string[]> = {};
        Object.keys(r).forEach((k) => {
          if (["style_id", "perspective"].includes(k)) return;
          obj[k] = String(r[k]).split(",").map((s) => s.trim()).filter(Boolean);
        });
        target.preselect[persp as Perspective] = obj;
        ok++;
      });
      setStyles(next);
      if (errors.length > 0) toast.error(`成功 ${ok} 行，失败 ${errors.length} 行：${errors.slice(0, 3).join("; ")}`);
      else toast.success(`成功导入 ${ok} 行预选标签`);
    } catch (e: any) {
      toast.error(`解析失败：${e.message}`);
    } finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const csv = "style_id,image_url,angle\nSTY-001,https://example.com/a.jpg,front\nSTY-001,https://example.com/b.jpg,back\nSTY-002,https://example.com/c.jpg,front";
    saveAs(new Blob([csv], { type: "text/csv" }), "styles_template.csv");
  };

  const save = () => {
    const x = loadDB();
    if (isNew) {
      x.datasets.push({ id: uid(), name, description: desc, styles, createdAt: Date.now(), updatedAt: Date.now() });
    } else {
      const i = x.datasets.findIndex((d) => d.id === id);
      x.datasets[i] = { ...x.datasets[i], name, description: desc, styles, updatedAt: Date.now() };
    }
    saveDB(x);
    toast.success("已保存");
    onClose();
  };

  const filtered = styles.filter((s) => s.styleId.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <Button size="sm" variant="ghost" onClick={onClose}>← 返回</Button>
      <h1 className="text-2xl font-bold">{isNew ? "新建" : "编辑"}数据集</h1>
      <div className="space-y-2">
        <label className="text-sm">名称</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <label className="text-sm">描述</label>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">款式上传 (CSV/XLSX) {busy && <span className="text-xs text-primary ml-2">解析中…</span>}</h3>
          <Button size="sm" variant="outline" onClick={downloadTemplate}>下载模板</Button>
        </div>
        <p className="text-xs text-muted-foreground">列：style_id, image_url, angle（可选）。同 style_id 的多行自动归为一个款式的多张图。</p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && handleStylesCsv(e.target.files[0])} />
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">预选标签上传 (CSV/XLSX)</h3>
        </div>
        <p className="text-xs text-muted-foreground">列：style_id, perspective, 其他字段（多值用逗号分隔）。</p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && handlePreselect(e.target.files[0])} />
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">款式管理 ({styles.length})</h3>
          <Input placeholder="搜索款式ID" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48 h-8" />
        </div>
        <div className="space-y-2 max-h-96 overflow-auto">
          {filtered.map((s) => (
            <div key={s.id} className="border rounded p-2 flex gap-2 items-center">
              <div className="font-medium text-sm w-24">{s.styleId}</div>
              <div className="flex gap-1 flex-1 overflow-auto">
                {s.images.map((im, i) => (
                  <div key={i} className="relative">
                    <img src={im.url} className="w-14 h-14 object-cover rounded" alt="" />
                    <div className="text-[10px] text-center">{im.angle || ""}</div>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => {
                if (!confirm(`删除款式 ${s.styleId}?`)) return;
                setStyles((p) => p.filter((x) => x.id !== s.id));
              }}>删除</Button>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-xs text-muted-foreground">暂无款式</div>}
        </div>
      </Card>

      <Button onClick={save}>保存</Button>
    </div>
  );
}

// ---------------- Tasks ----------------
export function AdminTasks() {
  const db = useDB();
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAnnotator, setBatchAnnotator] = useState("");
  const [batchReviewer, setBatchReviewer] = useState("");

  const filtered = db.tasks.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));

  const del = (id: string) => {
    if (!confirm("确认删除该任务？")) return;
    const x = loadDB();
    x.tasks = x.tasks.filter((t) => t.id !== id);
    x.annotations = x.annotations.filter((a) => a.taskId !== id);
    saveDB(x);
    toast.success("已删除");
  };

  const forceReject = (annoId: string) => {
    const reason = prompt("打回原因");
    if (!reason) return;
    const x = loadDB();
    const i = x.annotations.findIndex((a) => a.id === annoId);
    if (i < 0) return;
    x.annotations[i].status = "rejected";
    x.annotations[i].rejectReason = reason;
    x.annotations[i].history.push({ ts: Date.now(), status: "rejected", by: "admin", reason });
    saveDB(x);
    toast.success("已强制打回");
  };

  const applyBatch = () => {
    const x = loadDB();
    selected.forEach((tid) => {
      const t = x.tasks.find((tt) => tt.id === tid);
      if (!t) return;
      if (batchAnnotator && !t.annotators.find((a) => a.userPid === batchAnnotator)) {
        t.annotators.push({ userPid: batchAnnotator, perspectives: [...PERSPECTIVES] });
      }
      if (batchReviewer && !t.reviewers.includes(batchReviewer)) {
        t.reviewers.push(batchReviewer);
      }
    });
    saveDB(x);
    toast.success(`批量分配 ${selected.size} 个任务`);
    setSelected(new Set());
    setBatchOpen(false);
  };

  if (editing !== null) return <TaskEditor id={editing} onClose={() => setEditing(null)} />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between mb-4 items-center gap-2">
        <h1 className="text-2xl font-bold">任务管理</h1>
        <div className="flex gap-2">
          <Input placeholder="搜索任务…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          {selected.size > 0 && <Button size="sm" variant="outline" onClick={() => setBatchOpen(true)}>批量分配 ({selected.size})</Button>}
          <Button onClick={() => setEditing("__new")}>新建任务</Button>
        </div>
      </div>
      <div className="space-y-3">
        {filtered.map((t) => {
          const ds = db.datasets.find((d) => d.id === t.datasetId);
          const total = (ds?.styles.length || 0);
          const submitted = db.annotations.filter((a) => a.taskId === t.id && ["submitted", "approved"].includes(a.status)).length;
          return (
            <Card key={t.id} className="p-4">
              <div className="flex justify-between gap-2">
                <div className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={selected.has(t.id)} onChange={(e) => {
                    const s = new Set(selected);
                    if (e.target.checked) s.add(t.id); else s.delete(t.id);
                    setSelected(s);
                  }} />
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">数据集：{ds?.name} · 截止 {t.deadline}</div>
                    <div className="text-xs">进度 {submitted}/{total}</div>
                    <div className="text-xs text-muted-foreground">标注员：{t.annotators.map(a => a.userPid).join(", ")} · 审核员：{t.reviewers.join(", ")}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(t.id)}>编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => del(t.id)}>删除</Button>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium">已提交标注（可强制打回）：</div>
                {db.annotations.filter((a) => a.taskId === t.id).slice(0, 5).map((a) => (
                  <div key={a.id} className="text-xs flex items-center gap-2 border-t pt-1">
                    <span>{a.styleId}</span><span>{PERSPECTIVE_LABEL[a.perspective]}</span><span>[{a.status}]</span>
                    {a.status !== "rejected" && <Button size="sm" variant="ghost" className="h-6" onClick={() => forceReject(a.id)}>强制打回</Button>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>批量分配人员</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div className="text-sm">将对 {selected.size} 个任务追加：</div>
            <select className="border rounded px-2 py-2 w-full" value={batchAnnotator} onChange={(e) => setBatchAnnotator(e.target.value)}>
              <option value="">不变更标注员</option>
              {db.users.filter(u => u.role === "annotator").map(u => <option key={u.pid} value={u.pid}>{u.username} ({u.pid})</option>)}
            </select>
            <select className="border rounded px-2 py-2 w-full" value={batchReviewer} onChange={(e) => setBatchReviewer(e.target.value)}>
              <option value="">不变更审核员</option>
              {db.users.filter(u => u.role === "reviewer").map(u => <option key={u.pid} value={u.pid}>{u.username} ({u.pid})</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>取消</Button>
            <Button onClick={applyBatch}>应用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const db = useDB();
  const isNew = id === "__new";
  const ex = db.tasks.find((t) => t.id === id);
  const [name, setName] = useState(ex?.name || "");
  const [datasetId, setDatasetId] = useState(ex?.datasetId || db.datasets[0]?.id || "");
  const [libraryKey, setLib] = useState(ex?.libraryKey || db.libraries[0]?.key || "");
  const [annotators, setAn] = useState(ex?.annotators || []);
  const [reviewers, setRev] = useState(ex?.reviewers || []);
  const [deadline, setDl] = useState(ex?.deadline || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));

  const toggleAnnotator = (pid: string) => {
    setAn((prev) => prev.find((a) => a.userPid === pid) ? prev.filter((a) => a.userPid !== pid) : [...prev, { userPid: pid, perspectives: [...PERSPECTIVES] }]);
  };
  const togglePerspective = (pid: string, p: Perspective) => {
    setAn((prev) => prev.map((a) => a.userPid === pid ? { ...a, perspectives: a.perspectives.includes(p) ? a.perspectives.filter((x) => x !== p) : [...a.perspectives, p] } : a));
  };

  const save = () => {
    const x = loadDB();
    const data = { name, datasetId, libraryKey, annotators, reviewers, deadline };
    if (isNew) x.tasks.push({ id: uid(), createdAt: Date.now(), ...data });
    else { const i = x.tasks.findIndex((t) => t.id === id); x.tasks[i] = { ...x.tasks[i], ...data }; }
    saveDB(x);
    toast.success("已保存");
    onClose();
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-3">
      <Button size="sm" variant="ghost" onClick={onClose}>← 返回</Button>
      <h1 className="text-2xl font-bold">{isNew ? "新建" : "编辑"}任务</h1>
      <Input placeholder="任务名称" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="border rounded px-2 py-2 w-full" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
        {db.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <select className="border rounded px-2 py-2 w-full" value={libraryKey} onChange={(e) => setLib(e.target.value)}>
        {db.libraries.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
      </select>
      <Input type="date" value={deadline} onChange={(e) => setDl(e.target.value)} />
      <Card className="p-3">
        <div className="font-medium mb-2">标注员（含视角权限）</div>
        {db.users.filter((u) => u.role === "annotator").map((u) => {
          const sel = annotators.find((a) => a.userPid === u.pid);
          return (
            <div key={u.pid} className="border-b py-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!sel} onChange={() => toggleAnnotator(u.pid)} />
                <span>{u.username} ({u.pid})</span>
              </label>
              {sel && (
                <div className="ml-6 flex gap-3 mt-1">
                  {PERSPECTIVES.map((p) => (
                    <label key={p} className="text-xs flex items-center gap-1">
                      <input type="checkbox" checked={sel.perspectives.includes(p)} onChange={() => togglePerspective(u.pid, p)} />
                      {PERSPECTIVE_LABEL[p]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
      <Card className="p-3">
        <div className="font-medium mb-2">审核员</div>
        {db.users.filter((u) => u.role === "reviewer").map((u) => (
          <label key={u.pid} className="flex items-center gap-2">
            <input type="checkbox" checked={reviewers.includes(u.pid)} onChange={() => setRev((r) => r.includes(u.pid) ? r.filter((x) => x !== u.pid) : [...r, u.pid])} />
            {u.username} ({u.pid})
          </label>
        ))}
      </Card>
      <Button onClick={save}>保存</Button>
    </div>
  );
}

// ---------------- Users ----------------
export function AdminUsers() {
  const db = useDB();
  const [editing, setEditing] = useState<any>(null);

  const del = (pid: string) => {
    if (!confirm("确认删除该用户？")) return;
    const x = loadDB();
    x.users = x.users.filter((u) => u.pid !== pid);
    saveDB(x);
  };

  const save = () => {
    const x = loadDB();
    if (editing.__new) {
      x.users.push({ ...editing, pid: editing.pid || `P${100 + x.users.length + 1}` });
    } else {
      const i = x.users.findIndex((u) => u.pid === editing.pid);
      x.users[i] = editing;
    }
    saveDB(x); setEditing(null); toast.success("已保存");
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-3">
        <h1 className="text-2xl font-bold">用户管理</h1>
        <Button onClick={() => setEditing({ __new: true, pid: "", username: "", password: "", role: "annotator", perspectives: [] })}>新建用户</Button>
      </div>
      <div className="space-y-2">
        {db.users.map((u) => (
          <Card key={u.pid} className="p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{u.username} <span className="text-xs text-muted-foreground">{u.pid} · {u.role}</span></div>
              <div className="text-xs">视角权限：{u.perspectives.join(", ") || "—"}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing({ ...u })}>编辑</Button>
              <Button size="sm" variant="destructive" onClick={() => del(u.pid)}>删除</Button>
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <Card className="p-4 mt-4 space-y-2">
          <h3 className="font-semibold">{editing.__new ? "新建" : "编辑"}用户</h3>
          <Input placeholder="PID" value={editing.pid} onChange={(e) => setEditing({ ...editing, pid: e.target.value })} disabled={!editing.__new} />
          <Input placeholder="用户名" value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} />
          <Input placeholder="密码" value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} />
          <select className="border rounded px-2 py-2 w-full" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
            <option value="annotator">annotator</option><option value="reviewer">reviewer</option><option value="admin">admin</option>
          </select>
          <div className="flex gap-3">
            {PERSPECTIVES.map((p) => (
              <label key={p} className="text-sm flex items-center gap-1">
                <input type="checkbox" checked={editing.perspectives.includes(p)} onChange={() => setEditing({
                  ...editing,
                  perspectives: editing.perspectives.includes(p) ? editing.perspectives.filter((x: string) => x !== p) : [...editing.perspectives, p],
                })} />
                {PERSPECTIVE_LABEL[p]}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={save}>保存</Button>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------------- Rules ----------------
export function AdminRules() {
  const db = useDB();
  const [editing, setEditing] = useState<any>(null);
  const [filterLib, setFilterLib] = useState("");
  const [filterField, setFilterField] = useState("");

  const save = () => {
    const x = loadDB();
    if (editing.__new) x.rules.push({ ...editing, id: uid(), updatedAt: Date.now() });
    else {
      const i = x.rules.findIndex((r) => r.id === editing.id);
      x.ruleVersions.push({ id: uid(), ruleId: editing.id, snapshot: x.rules[i], ts: Date.now() });
      x.rules[i] = { ...editing, updatedAt: Date.now() };
    }
    saveDB(x);
    if (editing.status === "published") log("rule_publish", "admin", `${editing.libraryKey}/${editing.fieldKey}/${editing.optionValue}`);
    else log("rule_save", "admin", `${editing.libraryKey}/${editing.fieldKey}/${editing.optionValue}`);
    setEditing(null); toast.success("已保存");
  };

  const del = (id: string) => {
    if (!confirm("确认删除该规则？仅草稿可删")) return;
    const x = loadDB();
    x.rules = x.rules.filter((r) => r.id !== id || r.status !== "draft");
    saveDB(x);
  };

  const exportRules = () => {
    const blob = new Blob([JSON.stringify(db.rules, null, 2)], { type: "application/json" });
    saveAs(blob, "rules.json");
    log("rule_export", "admin");
  };
  const importRules = async (file: File) => {
    try {
      const txt = await file.text();
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error("应为数组");
      const x = loadDB();
      arr.forEach((r) => {
        const i = x.rules.findIndex((rr) => rr.id === r.id);
        if (i >= 0) x.rules[i] = r; else x.rules.push(r);
      });
      saveDB(x);
      log("rule_import", "admin", `${arr.length} 条`);
      toast.success(`已导入 ${arr.length} 条`);
    } catch (e: any) { toast.error(`导入失败：${e.message}`); }
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, 3 - (editing.positiveImages?.length || 0));
    const reads = await Promise.all(list.map((f) => new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(f);
    })));
    setEditing({ ...editing, positiveImages: [...(editing.positiveImages || []), ...reads].slice(0, 3) });
  };

  const filtered = db.rules.filter((r) =>
    (!filterLib || r.libraryKey === filterLib) && (!filterField || r.fieldKey.includes(filterField))
  );

  const curLib = db.libraries.find((l) => l.key === (editing?.libraryKey));
  const curField = curLib?.fields.find((f) => f.key === editing?.fieldKey);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-3 items-center gap-2">
        <h1 className="text-2xl font-bold">打标规则管理</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportRules}>导出 JSON</Button>
          <label className="text-sm border rounded px-3 py-1.5 cursor-pointer hover:bg-muted">导入 JSON
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importRules(e.target.files[0])} />
          </label>
          <Button onClick={() => setEditing({ __new: true, libraryKey: db.libraries[0]?.key, fieldKey: "", optionValue: "", definition: "", criteria: "", positiveImages: [], exclusive: [], dependency: "", notRecommended: false, notes: "", status: "draft" })}>新建规则</Button>
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <select className="border rounded px-2 py-1.5 text-sm" value={filterLib} onChange={(e) => setFilterLib(e.target.value)}>
          <option value="">所有库</option>
          {db.libraries.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
        </select>
        <Input placeholder="按字段筛选" value={filterField} onChange={(e) => setFilterField(e.target.value)} className="w-48 h-8" />
      </div>
      <div className="space-y-2">
        {filtered.map((r) => (
          <Card key={r.id} className="p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{r.libraryKey} / {r.fieldKey} / {r.optionValue}</div>
              <div className="text-xs text-muted-foreground">{r.definition} <span className="ml-2">[{r.status}]</span> {r.positiveImages?.length > 0 && <span className="ml-2">📷 {r.positiveImages.length}</span>}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing({ ...r })}>编辑</Button>
              <Button size="sm" variant="outline" onClick={() => { const x = loadDB(); x.rules.push({ ...r, id: uid(), status: "draft", updatedAt: Date.now() }); saveDB(x); }}>复制</Button>
              {r.status === "draft" && <Button size="sm" variant="destructive" onClick={() => del(r.id)}>删除</Button>}
            </div>
          </Card>
        ))}
      </div>
      {editing && (
        <Card className="p-4 mt-4 space-y-2">
          <h3 className="font-semibold">规则编辑</h3>
          <select className="border rounded px-2 py-2 w-full text-sm" value={editing.libraryKey} onChange={(e) => setEditing({ ...editing, libraryKey: e.target.value, fieldKey: "" })}>
            {db.libraries.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
          </select>
          <select className="border rounded px-2 py-2 w-full text-sm" value={editing.fieldKey} onChange={(e) => setEditing({ ...editing, fieldKey: e.target.value, optionValue: "" })}>
            <option value="">选择字段</option>
            {curLib?.fields.filter((f) => f.type !== "text").map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
          </select>
          <select className="border rounded px-2 py-2 w-full text-sm" value={editing.optionValue} onChange={(e) => setEditing({ ...editing, optionValue: e.target.value })}>
            <option value="">选择标签值</option>
            {curField?.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Input placeholder="定义" value={editing.definition} onChange={(e) => setEditing({ ...editing, definition: e.target.value })} />
          <Input placeholder="判断标准" value={editing.criteria} onChange={(e) => setEditing({ ...editing, criteria: e.target.value })} />
          <div>
            <div className="text-xs mb-1">互斥标签（同字段）：</div>
            <div className="flex flex-wrap gap-1">
              {curField?.options.filter((o) => o !== editing.optionValue).map((o) => (
                <label key={o} className="text-xs border rounded px-2 py-1 flex items-center gap-1">
                  <input type="checkbox" checked={editing.exclusive.includes(o)} onChange={() => setEditing({
                    ...editing,
                    exclusive: editing.exclusive.includes(o) ? editing.exclusive.filter((x: string) => x !== o) : [...editing.exclusive, o],
                  })} />{o}
                </label>
              ))}
            </div>
          </div>
          <Input placeholder='依赖条件 e.g. category == "连衣裙"' value={editing.dependency} onChange={(e) => setEditing({ ...editing, dependency: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={editing.notRecommended} onChange={(e) => setEditing({ ...editing, notRecommended: e.target.checked })} />
            默认不推荐
          </label>
          <div>
            <div className="text-xs mb-1">正例图（最多3张）：</div>
            <div className="flex gap-2 flex-wrap mb-1">
              {(editing.positiveImages || []).map((img: string, i: number) => (
                <div key={i} className="relative">
                  <img src={img} className="w-20 h-20 object-cover rounded" alt="" />
                  <button className="absolute top-0 right-0 bg-destructive text-destructive-foreground text-xs w-5 h-5 rounded-full" onClick={() =>
                    setEditing({ ...editing, positiveImages: editing.positiveImages.filter((_: any, j: number) => j !== i) })
                  }>×</button>
                </div>
              ))}
            </div>
            {(editing.positiveImages?.length || 0) < 3 && (
              <input type="file" accept="image/*" multiple onChange={(e) => handleImageUpload(e.target.files)} />
            )}
          </div>
          <select className="border rounded px-2 py-2" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
            <option value="draft">草稿</option><option value="published">已发布</option>
          </select>
          <div className="flex gap-2"><Button onClick={save}>保存</Button><Button variant="outline" onClick={() => setEditing(null)}>取消</Button></div>
        </Card>
      )}
    </div>
  );
}

// ---------------- Libraries ----------------
export function AdminLibraries() {
  const db = useDB();
  const [libKey, setLibKey] = useState(db.libraries[0]?.key || "");
  const lib = db.libraries.find((l) => l.key === libKey);

  const updateRule = (craft: string, parts: string[]) => {
    const x = loadDB();
    const i = x.libraries.findIndex((l) => l.key === libKey);
    if (i < 0 || !x.libraries[i].craftPart) return;
    x.libraries[i].craftPart!.rules[craft] = parts;
    saveDB(x);
  };

  const importExcel = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    const x = loadDB();
    const i = x.libraries.findIndex((l) => l.key === libKey);
    if (i < 0 || !x.libraries[i].craftPart) return;
    rows.forEach((r) => {
      x.libraries[i].craftPart!.rules[r.craft] = String(r.parts).split(",").map((s) => s.trim());
    });
    saveDB(x);
    toast.success(`导入 ${rows.length} 条`);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">库管理</h1>
      <select className="border rounded px-2 py-2" value={libKey} onChange={(e) => setLibKey(e.target.value)}>
        {db.libraries.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
      </select>
      {lib && (
        <>
          <Card className="p-4">
            <h3 className="font-semibold mb-2">字段配置</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th>key</th><th>label</th><th>类型</th><th>选项</th><th>自定义</th></tr></thead>
              <tbody>
                {lib.fields.map((f) => (
                  <tr key={f.key} className="border-t"><td>{f.key}</td><td>{f.label}</td><td>{f.type}</td><td className="text-xs">{f.options.join(", ")}</td><td>{f.allowCustom ? "✓" : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
          {lib.craftPart && (
            <Card className="p-4">
              <h3 className="font-semibold mb-2">工艺-部位关联</h3>
              <p className="text-xs text-muted-foreground">字段：{lib.craftPart.craftField} ↔ {lib.craftPart.partField}</p>
              <input type="file" accept=".xlsx,.csv" onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
              <table className="w-full text-sm mt-2">
                <thead><tr><th className="text-left">工艺</th><th className="text-left">允许部位（逗号分隔）</th></tr></thead>
                <tbody>
                  {Object.entries(lib.craftPart.rules).map(([craft, parts]) => (
                    <tr key={craft} className="border-t">
                      <td className="py-1">{craft}</td>
                      <td><Input defaultValue={parts.join(",")} onBlur={(e) => updateRule(craft, e.target.value.split(",").map((s) => s.trim()))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- Tag Pool ----------------
export function AdminTagPool() {
  const db = useDB();
  const [tab, setTab] = useState<"pool" | "custom">("pool");
  const [libKey, setLibKey] = useState(db.libraries[0]?.key || "");
  const lib = db.libraries.find((l) => l.key === libKey);
  const fields = (lib?.fields || []).filter((f) => f.type !== "text");
  const [fieldKey, setFieldKey] = useState(fields[0]?.key || "");
  const field = fields.find((f) => f.key === fieldKey) || fields[0];

  const [newTag, setNewTag] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 12;
  const [mergeFrom, setMergeFrom] = useState<Set<string>>(new Set());
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTo, setMergeTo] = useState("");

  const usage = useMemo(() => {
    const map: Record<string, number> = {};
    db.annotations.forEach((a) => {
      Object.entries(a.data).forEach(([fk, vs]) => {
        const arr = Array.isArray(vs) ? vs : [vs];
        arr.forEach((v) => { if (v) map[`${fk}::${v}`] = (map[`${fk}::${v}`] || 0) + 1; });
      });
    });
    return map;
  }, [db.annotations]);

  if (!lib || !field) return <div className="p-6">无库</div>;

  const filtered = field.options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const sorted = [...filtered].sort((a, b) => (usage[`${field.key}::${b}`] || 0) - (usage[`${field.key}::${a}`] || 0));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  const addTag = () => {
    const v = newTag.trim();
    if (!v) return;
    if (field.options.includes(v)) { toast.error("已存在"); return; }
    const x = loadDB();
    const li = x.libraries.findIndex((l) => l.key === libKey);
    const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
    x.libraries[li].fields[fi].options.push(v);
    saveDB(x);
    log("tag_add", "admin", `${libKey}/${fieldKey}: +${v}`);
    setNewTag("");
    toast.success("已添加");
  };

  const editTag = (old: string) => {
    const next = prompt("修改标签名", old);
    if (!next || next === old) return;
    if (field.options.includes(next)) { toast.error("名称重复"); return; }
    const x = loadDB();
    const li = x.libraries.findIndex((l) => l.key === libKey);
    const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
    x.libraries[li].fields[fi].options = x.libraries[li].fields[fi].options.map((o) => o === old ? next : o);
    x.annotations.forEach((a) => {
      const cur = a.data[fieldKey];
      if (Array.isArray(cur)) a.data[fieldKey] = cur.map((v) => v === old ? next : v);
    });
    saveDB(x);
    log("tag_rename", "admin", `${libKey}/${fieldKey}: ${old} -> ${next}`);
    toast.success("已修改");
  };

  const deleteTag = (val: string) => {
    const used = usage[`${field.key}::${val}`] || 0;
    if (used > 0) {
      const choice = prompt(`「${val}」已被使用 ${used} 次。输入 "force" 强制删除（移除标注中该标签）；输入 "disable" 仅停用（保留历史，从选项移除）；其他取消。`);
      if (choice !== "force" && choice !== "disable") return;
      const x = loadDB();
      const li = x.libraries.findIndex((l) => l.key === libKey);
      const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
      x.libraries[li].fields[fi].options = x.libraries[li].fields[fi].options.filter((o) => o !== val);
      if (choice === "force") {
        x.annotations.forEach((a) => {
          const cur = a.data[fieldKey];
          if (Array.isArray(cur)) a.data[fieldKey] = cur.filter((v) => v !== val);
        });
      }
      saveDB(x);
      log(choice === "force" ? "tag_force_delete" : "tag_disable", "admin", `${libKey}/${fieldKey}: ${val}`);
      toast.success("操作完成");
    } else {
      if (!confirm(`删除「${val}」？`)) return;
      const x = loadDB();
      const li = x.libraries.findIndex((l) => l.key === libKey);
      const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
      x.libraries[li].fields[fi].options = x.libraries[li].fields[fi].options.filter((o) => o !== val);
      saveDB(x);
      log("tag_delete", "admin", `${libKey}/${fieldKey}: ${val}`);
    }
  };

  const importTags = async (file: File, mode: "append" | "replace") => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const tags = rows.flat().map((v) => String(v).trim()).filter(Boolean);
      if (tags.length === 0) { toast.error("文件为空或解析失败：未读到任何标签"); return; }
      const x = loadDB();
      const li = x.libraries.findIndex((l) => l.key === libKey);
      const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
      if (mode === "replace") x.libraries[li].fields[fi].options = Array.from(new Set(tags));
      else {
        const cur = new Set(x.libraries[li].fields[fi].options);
        tags.forEach((t) => cur.add(t));
        x.libraries[li].fields[fi].options = Array.from(cur);
      }
      saveDB(x);
      log("tag_import", "admin", `${libKey}/${fieldKey}: ${mode} ${tags.length}`);
      toast.success(`已${mode === "replace" ? "覆盖" : "追加"} ${tags.length} 个标签`);
    } catch (e: any) { toast.error(`解析失败：${e.message}`); }
  };

  const exportTags = () => {
    const data = field.options.map((o) => ({ tag: o, usage: usage[`${field.key}::${o}`] || 0 }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "tags");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    saveAs(new Blob([buf]), `${libKey}_${fieldKey}_tags.xlsx`);
  };

  const doMerge = () => {
    if (!mergeTo || mergeFrom.size === 0) return;
    if (!confirm(`将 ${[...mergeFrom].join(", ")} 合并为「${mergeTo}」？标注数据会迁移。`)) return;
    const x = loadDB();
    const li = x.libraries.findIndex((l) => l.key === libKey);
    const fi = x.libraries[li].fields.findIndex((f) => f.key === fieldKey);
    const f = x.libraries[li].fields[fi];
    if (!f.options.includes(mergeTo)) f.options.push(mergeTo);
    f.options = f.options.filter((o) => !mergeFrom.has(o) || o === mergeTo);
    x.annotations.forEach((a) => {
      const cur = a.data[fieldKey];
      if (Array.isArray(cur)) a.data[fieldKey] = Array.from(new Set(cur.map((v) => mergeFrom.has(v) ? mergeTo : v)));
      a.history.forEach((h) => {
        const hc = h.data?.[fieldKey];
        if (Array.isArray(hc)) h.data![fieldKey] = Array.from(new Set(hc.map((v) => mergeFrom.has(v) ? mergeTo : v)));
      });
    });
    saveDB(x);
    log("tag_merge", "admin", `${libKey}/${fieldKey}: ${[...mergeFrom].join(",")} -> ${mergeTo}`);
    toast.success("已合并");
    setMergeOpen(false); setMergeFrom(new Set()); setMergeTo("");
  };

  // Custom tag review
  const handleCustom = (id: string, status: "approved" | "rejected") => {
    const x = loadDB();
    const i = x.tagRequests.findIndex((t) => t.id === id);
    if (i < 0) return;
    x.tagRequests[i].status = status;
    if (status === "approved") {
      const r = x.tagRequests[i];
      const lb = x.libraries.find((l) => l.key === r.libraryKey);
      const f = lb?.fields.find((f) => f.key === r.fieldKey);
      if (f && !f.options.includes(r.value)) f.options.push(r.value);
    }
    saveDB(x);
    log(`custom_tag_${status}`, "admin", `${x.tagRequests[i].libraryKey}/${x.tagRequests[i].fieldKey}: ${x.tagRequests[i].value}`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">标签池管理</h1>
      <div className="flex gap-2 border-b">
        <button onClick={() => setTab("pool")} className={`px-4 py-2 text-sm ${tab === "pool" ? "border-b-2 border-primary font-semibold" : ""}`}>固定标签池</button>
        <button onClick={() => setTab("custom")} className={`px-4 py-2 text-sm ${tab === "custom" ? "border-b-2 border-primary font-semibold" : ""}`}>
          自定义标签审核 ({db.tagRequests.filter((r) => r.status === "pending").length})
        </button>
      </div>

      {tab === "pool" && (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex gap-2 items-center flex-wrap">
              <select className="border rounded px-2 py-1.5 text-sm" value={libKey} onChange={(e) => { setLibKey(e.target.value); setPage(0); }}>
                {db.libraries.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
              </select>
              <select className="border rounded px-2 py-1.5 text-sm" value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setPage(0); }}>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <Input placeholder="搜索标签…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="w-48 h-8" />
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportTags}>导出 Excel</Button>
              <label className="text-xs border rounded px-2 py-1.5 cursor-pointer hover:bg-muted">
                追加导入<input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && importTags(e.target.files[0], "append")} />
              </label>
              <label className="text-xs border rounded px-2 py-1.5 cursor-pointer hover:bg-muted">
                覆盖导入<input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && importTags(e.target.files[0], "replace")} />
              </label>
              <Button size="sm" variant="outline" disabled={mergeFrom.size < 2} onClick={() => setMergeOpen(true)}>合并 ({mergeFrom.size})</Button>
            </div>
            <div className="flex gap-2">
              <Input placeholder="新增标签名" value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} className="h-8" />
              <Button size="sm" onClick={addTag}>新增</Button>
            </div>

            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-1 w-8"></th>
                  <th>标签</th>
                  <th>使用次数</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr key={o} className="border-b">
                    <td><input type="checkbox" checked={mergeFrom.has(o)} onChange={(e) => {
                      const s = new Set(mergeFrom);
                      if (e.target.checked) s.add(o); else s.delete(o);
                      setMergeFrom(s);
                    }} /></td>
                    <td className="py-1.5">{o}</td>
                    <td>{usage[`${field.key}::${o}`] || 0}</td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => editTag(o)}>编辑</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => deleteTag(o)}>删除</Button>
                    </td>
                  </tr>
                ))}
                {paged.length === 0 && <tr><td colSpan={4} className="text-center text-muted-foreground py-4">暂无</td></tr>}
              </tbody>
            </table>
            <div className="flex justify-between items-center text-xs">
              <span>共 {sorted.length} 个</span>
              <div className="flex gap-2 items-center">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <span>{page + 1} / {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          </Card>

          <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
            <DialogContent>
              <DialogHeader><DialogTitle>合并标签</DialogTitle></DialogHeader>
              <div className="text-sm space-y-2">
                <div>源标签：{[...mergeFrom].join(", ")}</div>
                <div>合并为：</div>
                <Input value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} placeholder="目标标签名" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMergeOpen(false)}>取消</Button>
                <Button onClick={doMerge}>确认合并</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {tab === "custom" && (
        <Card className="p-4 space-y-2">
          {db.tagRequests.length === 0 && <div className="text-muted-foreground text-sm">暂无</div>}
          {db.libraries.map((lb) => {
            const reqs = db.tagRequests.filter((r) => r.libraryKey === lb.key);
            if (reqs.length === 0) return null;
            return (
              <div key={lb.key} className="border-t pt-2">
                <div className="font-medium text-sm">{lb.name}</div>
                {lb.fields.map((f) => {
                  const fr = reqs.filter((r) => r.fieldKey === f.key);
                  if (fr.length === 0) return null;
                  return (
                    <div key={f.key} className="ml-2 mt-1">
                      <div className="text-xs text-muted-foreground">{f.label}</div>
                      {fr.map((r) => (
                        <div key={r.id} className="flex items-center justify-between border-b py-1.5 text-sm">
                          <span><b>{r.value}</b> <span className="text-xs text-muted-foreground">by {r.byPid} · [{r.status}]</span></span>
                          {r.status === "pending" && (
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => handleCustom(r.id, "approved")}>批准</Button>
                              <Button size="sm" variant="outline" onClick={() => handleCustom(r.id, "rejected")}>拒绝</Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

// ---------------- Logs ----------------
export function AdminLogs() {
  const db = useDB();
  const [filterAction, setFilterAction] = useState("");
  const [filterPid, setFilterPid] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const PAGE = 30;
  const actions = useMemo(() => Array.from(new Set(db.logs.map((l) => l.action))), [db.logs]);
  const filtered = db.logs.filter((l) => {
    if (filterAction && l.action !== filterAction) return false;
    if (filterPid && !l.pid.includes(filterPid)) return false;
    if (fromDate && l.ts < new Date(fromDate).getTime()) return false;
    if (toDate && l.ts > new Date(toDate).getTime() + 86400000) return false;
    return true;
  });
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">操作日志</h1>
      <div className="flex gap-2 mb-3 flex-wrap">
        <select className="border rounded px-2 py-1.5 text-sm" value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}>
          <option value="">所有操作类型</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <Input placeholder="按 PID 过滤" value={filterPid} onChange={(e) => { setFilterPid(e.target.value); setPage(0); }} className="w-40" />
        <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} className="w-40" />
        <Input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(0); }} className="w-40" />
      </div>
      <Card className="p-4 max-h-[60vh] overflow-auto">
        {paged.map((l) => (
          <div key={l.id} className="border-b py-1 text-xs flex gap-3">
            <span className="text-muted-foreground">{new Date(l.ts).toLocaleString()}</span>
            <span className="font-medium">{l.pid}</span>
            <span>{l.action}</span>
            <span className="text-muted-foreground">{l.detail}</span>
          </div>
        ))}
        {paged.length === 0 && <div className="text-sm text-muted-foreground">暂无日志</div>}
      </Card>
      <div className="flex justify-between items-center text-xs mt-2">
        <span>共 {filtered.length} 条</span>
        <div className="flex gap-2 items-center">
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
          <span>{page + 1} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Dataset Detail (multi-select + image modal) ----------------
function DatasetDetail({ id, onClose, exportZip, exportAnnotations }: {
  id: string; onClose: () => void;
  exportZip: (id: string) => void; exportAnnotations: (id: string) => void;
}) {
  const db = useDB();
  const ds = db.datasets.find((d) => d.id === id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [viewSty, setViewSty] = useState<string | null>(null);
  if (!ds) return <div className="p-6">数据集不存在</div>;

  const filtered = ds.styles.filter((s) => s.styleId.toLowerCase().includes(search.toLowerCase()));

  const batchDelete = () => {
    if (selected.size === 0) return;
    if (!confirm(`确认删除 ${selected.size} 个款式及关联标注？`)) return;
    const x = loadDB();
    const di = x.datasets.findIndex((d) => d.id === id);
    x.datasets[di].styles = x.datasets[di].styles.filter((s) => !selected.has(s.id));
    x.annotations = x.annotations.filter((a) => !selected.has(a.styleId));
    saveDB(x);
    setSelected(new Set());
    toast.success("已批量删除");
  };

  const exportStyleJson = (sId: string) => {
    const annos = db.annotations.filter((a) => a.styleId === sId);
    const sty = ds.styles.find((s) => s.id === sId);
    const blob = new Blob([JSON.stringify({ style: sty, annotations: annos }, null, 2)], { type: "application/json" });
    saveAs(blob, `${sty?.styleId || sId}.json`);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Button size="sm" variant="ghost" onClick={onClose}>← 返回</Button>
      <div className="flex justify-between items-center my-3">
        <h1 className="text-2xl font-bold">{ds.name}</h1>
        <div className="flex gap-2">
          <Input placeholder="搜索款式ID" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          <Button size="sm" onClick={() => exportZip(ds.id)}>导出 ZIP</Button>
          <Button size="sm" variant="outline" onClick={() => exportAnnotations(ds.id)}>导出标注 JSON</Button>
        </div>
      </div>
      {selected.size > 0 && (
        <div className="bg-card border rounded p-2 mb-3 flex gap-2 items-center">
          <span className="text-sm">已选 {selected.size} 个</span>
          <Button size="sm" variant="destructive" onClick={batchDelete}>批量删除</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清空</Button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {filtered.map((s) => (
          <Card key={s.id} className="p-2 relative">
            <input type="checkbox" className="absolute top-2 left-2 z-10"
              checked={selected.has(s.id)}
              onChange={(e) => {
                const set = new Set(selected);
                if (e.target.checked) set.add(s.id); else set.delete(s.id);
                setSelected(set);
              }} />
            <div className="grid grid-cols-2 gap-1 cursor-pointer" onClick={() => setViewSty(s.id)}>
              {s.images.slice(0, 4).map((im, i) => (
                <img key={i} src={im.url} className="w-full h-20 object-cover rounded" alt="" />
              ))}
            </div>
            <div className="text-xs mt-1 font-medium">{s.styleId} <span className="text-muted-foreground">({s.images.length} 图)</span></div>
          </Card>
        ))}
      </div>

      <Dialog open={!!viewSty} onOpenChange={(o) => !o && setViewSty(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>款式标注详情</DialogTitle></DialogHeader>
          {viewSty && (() => {
            const sty = ds.styles.find((s) => s.id === viewSty)!;
            const annos = db.annotations.filter((a) => a.styleId === viewSty);
            return (
              <div className="space-y-3 max-h-[70vh] overflow-auto">
                <div className="flex gap-3 flex-wrap">
                  {sty.images.map((im, i) => (
                    <img key={i} src={im.url} className="w-32 h-32 object-cover rounded" alt="" />
                  ))}
                </div>
                <div>
                  <b>{sty.styleId}</b>
                  <Button size="sm" variant="outline" className="ml-2" onClick={() => exportStyleJson(viewSty)}>导出该款式标注 JSON</Button>
                </div>
                {PERSPECTIVES.map((p) => {
                  const a = annos.find((x) => x.perspective === p);
                  return (
                    <div key={p} className="border rounded p-2 bg-muted/30">
                      <div className="text-sm font-medium">{PERSPECTIVE_LABEL[p]} {a && <span className="text-xs text-muted-foreground">[{a.status}] {a.annotatorPid}</span>}</div>
                      {a ? (
                        <>
                          <div className="text-xs">数据：{JSON.stringify(a.data)}</div>
                          {a.craftPartGroups && a.craftPartGroups.length > 0 && <div className="text-xs">工艺-部位：{JSON.stringify(a.craftPartGroups)}</div>}
                          {a.customTags?.length > 0 && <div className="text-xs">自定义：{a.customTags.join(", ")}</div>}
                          <div className="text-xs text-muted-foreground">历史 ({a.history.length} 次)</div>
                        </>
                      ) : <div className="text-xs text-muted-foreground">尚无标注</div>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------- Backup / Restore ----------------
export function adminBackupExport() {
  const blob = new Blob([JSON.stringify(loadDB(), null, 2)], { type: "application/json" });
  saveAs(blob, `backup_${new Date().toISOString().slice(0, 10)}.json`);
}
