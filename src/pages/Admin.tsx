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
  const total = db.annotations.length;
  const submitted = db.annotations.filter((a) => a.status === "submitted").length;
  const approved = db.annotations.filter((a) => a.status === "approved").length;
  const rejected = db.annotations.filter((a) => a.status === "rejected").length;
  const tagDist: Record<string, number> = {};
  db.annotations.forEach((a) => {
    Object.values(a.data).forEach((vals) => {
      (Array.isArray(vals) ? vals : [vals]).forEach((v) => {
        if (v) tagDist[v as string] = (tagDist[v as string] || 0) + 1;
      });
    });
  });
  const tagData = Object.entries(tagDist).slice(0, 8).map(([name, value]) => ({ name, value }));
  const trend = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.now() - (6 - i) * 86400000);
    const ds = day.toISOString().slice(0, 10);
    const c = db.annotations.filter((a) => new Date(a.updatedAt).toISOString().slice(0, 10) === ds).length;
    return { day: ds.slice(5), count: c };
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">仪表盘</h1>
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="总标注数" v={total} />
        <StatCard label="待审核" v={submitted} />
        <StatCard label="已通过" v={approved} />
        <StatCard label="已打回" v={rejected} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">标签分布</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={tagData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                {tagData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-2">近一周标注趋势</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trend}>
              <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip />
              <Line dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
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
    const zip = new JSZip();
    const csv = ["filename,id"];
    ds.images.forEach((img) => csv.push(`${img.filename},${img.id}`));
    zip.file("labels.csv", csv.join("\n"));
    zip.file("dataset.json", JSON.stringify(ds, null, 2));
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${ds.name}.zip`);
  };

  const exportAnnotations = (id: string) => {
    const ds = db.datasets.find((d) => d.id === id)!;
    const tasks = db.tasks.filter((t) => t.datasetId === id);
    const merged = ds.images.map((img) => ({
      image: img,
      annotations: db.annotations.filter((a) => tasks.find((t) => t.id === a.taskId) && a.imageId === img.id),
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
              <div className="text-xs text-muted-foreground">{d.images.length} 张图片 · 创建 {new Date(d.createdAt).toLocaleDateString()}</div>
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
  const [images, setImages] = useState(ex?.images || []);
  const [search, setSearch] = useState("");

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => {
        setImages((prev) => [...prev, { id: uid(), filename: f.name, url: reader.result as string }]);
      };
      reader.readAsDataURL(f);
    });
  };

  const handleSheet = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws);
    let ok = 0, fail = 0;
    const next = [...images];
    rows.forEach((r) => {
      const fn = r["图片文件名"] || r.filename;
      const persp = r["perspective"];
      const target = next.find((i) => i.filename === fn);
      if (!target || !persp) { fail++; return; }
      target.preselect = target.preselect || {};
      const obj: Record<string, string[]> = {};
      Object.keys(r).forEach((k) => {
        if (k === "图片文件名" || k === "filename" || k === "perspective") return;
        obj[k] = String(r[k]).split(",").map((s) => s.trim()).filter(Boolean);
      });
      target.preselect[persp as Perspective] = obj;
      ok++;
    });
    setImages(next);
    toast.success(`成功 ${ok} 行，失败 ${fail} 行`);
  };

  const save = () => {
    const x = loadDB();
    if (isNew) {
      x.datasets.push({ id: uid(), name, description: desc, images, createdAt: Date.now(), updatedAt: Date.now() });
    } else {
      const i = x.datasets.findIndex((d) => d.id === id);
      x.datasets[i] = { ...x.datasets[i], name, description: desc, images, updatedAt: Date.now() };
    }
    saveDB(x);
    toast.success("已保存");
    onClose();
  };

  const filtered = images.filter((i) => i.filename.toLowerCase().includes(search.toLowerCase()));

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
          <h3 className="font-semibold">图片管理 ({images.length})</h3>
          <Input placeholder="搜索文件名" value={search} onChange={(e) => setSearch(e.target.value)} className="w-48 h-8" />
        </div>
        <input type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} />
        <div className="grid grid-cols-4 gap-2">
          {filtered.map((img) => (
            <div key={img.id} className="relative">
              <img src={img.url} className="w-full h-24 object-cover rounded" alt="" />
              <div className="text-xs truncate">{img.filename}</div>
              <button className="absolute top-1 right-1 bg-destructive text-white rounded px-1 text-xs" onClick={() => setImages((p) => p.filter((x) => x.id !== img.id))}>×</button>
            </div>
          ))}
        </div>
      </Card>
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold">预选标签上传 (CSV/XLSX)</h3>
        <p className="text-xs text-muted-foreground">需包含列：图片文件名、perspective、其它字段</p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && handleSheet(e.target.files[0])} />
      </Card>
      <Button onClick={save}>保存</Button>
    </div>
  );
}

// ---------------- Tasks ----------------
export function AdminTasks() {
  const db = useDB();
  const [editing, setEditing] = useState<string | null>(null);

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

  if (editing !== null) return <TaskEditor id={editing} onClose={() => setEditing(null)} />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between mb-4">
        <h1 className="text-2xl font-bold">任务管理</h1>
        <Button onClick={() => setEditing("__new")}>新建任务</Button>
      </div>
      <div className="space-y-3">
        {db.tasks.map((t) => {
          const ds = db.datasets.find((d) => d.id === t.datasetId);
          const total = (ds?.images.length || 0);
          const submitted = db.annotations.filter((a) => a.taskId === t.id && ["submitted", "approved"].includes(a.status)).length;
          return (
            <Card key={t.id} className="p-4">
              <div className="flex justify-between">
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">数据集：{ds?.name} · 截止 {t.deadline}</div>
                  <div className="text-xs">进度 {submitted}/{total}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(t.id)}>编辑</Button>
                  <Button size="sm" variant="destructive" onClick={() => del(t.id)}>删除</Button>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium">已提交标注（可强制打回）：</div>
                {db.annotations.filter((a) => a.taskId === t.id).map((a) => (
                  <div key={a.id} className="text-xs flex items-center gap-2 border-t pt-1">
                    <span>{a.imageId}</span><span>{PERSPECTIVE_LABEL[a.perspective]}</span><span>[{a.status}]</span>
                    {a.status !== "rejected" && <Button size="sm" variant="ghost" className="h-6" onClick={() => forceReject(a.id)}>打回</Button>}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
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

  const save = () => {
    const x = loadDB();
    if (editing.__new) x.rules.push({ ...editing, id: uid(), updatedAt: Date.now() });
    else {
      const i = x.rules.findIndex((r) => r.id === editing.id);
      x.ruleVersions.push({ id: uid(), ruleId: editing.id, snapshot: x.rules[i], ts: Date.now() });
      x.rules[i] = { ...editing, updatedAt: Date.now() };
    }
    saveDB(x); setEditing(null); toast.success("已保存");
  };

  const del = (id: string) => {
    if (!confirm("确认删除该规则？仅草稿可删")) return;
    const x = loadDB();
    x.rules = x.rules.filter((r) => r.id !== id || r.status !== "draft");
    saveDB(x);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between mb-3">
        <h1 className="text-2xl font-bold">打标规则管理</h1>
        <Button onClick={() => setEditing({ __new: true, libraryKey: db.libraries[0]?.key, fieldKey: "", optionValue: "", definition: "", criteria: "", positiveImages: [], exclusive: [], dependency: "", notRecommended: false, notes: "", status: "draft" })}>新建规则</Button>
      </div>
      <div className="space-y-2">
        {db.rules.map((r) => (
          <Card key={r.id} className="p-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{r.libraryKey} / {r.fieldKey} / {r.optionValue}</div>
              <div className="text-xs text-muted-foreground">{r.definition} <span className="ml-2">[{r.status}]</span></div>
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
          <Input placeholder="字段key" value={editing.fieldKey} onChange={(e) => setEditing({ ...editing, fieldKey: e.target.value })} />
          <Input placeholder="标签值" value={editing.optionValue} onChange={(e) => setEditing({ ...editing, optionValue: e.target.value })} />
          <Input placeholder="定义" value={editing.definition} onChange={(e) => setEditing({ ...editing, definition: e.target.value })} />
          <Input placeholder="判断标准" value={editing.criteria} onChange={(e) => setEditing({ ...editing, criteria: e.target.value })} />
          <Input placeholder="互斥标签 (逗号分隔)" value={editing.exclusive.join(",")} onChange={(e) => setEditing({ ...editing, exclusive: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} />
          <Input placeholder="依赖条件" value={editing.dependency} onChange={(e) => setEditing({ ...editing, dependency: e.target.value })} />
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
  const handle = (id: string, status: "approved" | "rejected") => {
    const x = loadDB();
    const i = x.tagRequests.findIndex((t) => t.id === id);
    if (i < 0) return;
    x.tagRequests[i].status = status;
    if (status === "approved") {
      const r = x.tagRequests[i];
      const lib = x.libraries.find((l) => l.key === r.libraryKey);
      const f = lib?.fields.find((f) => f.key === r.fieldKey);
      if (f && !f.options.includes(r.value)) f.options.push(r.value);
    }
    saveDB(x);
  };
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">标签池管理</h1>
      <Card className="p-4">
        <h3 className="font-semibold mb-2">自定义标签申请</h3>
        {db.tagRequests.length === 0 && <div className="text-muted-foreground text-sm">暂无</div>}
        {db.tagRequests.map((r) => (
          <div key={r.id} className="flex items-center justify-between border-t py-2">
            <div className="text-sm">{r.libraryKey} / {r.fieldKey}：<b>{r.value}</b> <span className="text-xs text-muted-foreground">[{r.status}]</span></div>
            {r.status === "pending" && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handle(r.id, "approved")}>批准</Button>
                <Button size="sm" variant="outline" onClick={() => handle(r.id, "rejected")}>拒绝</Button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

// ---------------- Logs ----------------
export function AdminLogs() {
  const db = useDB();
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">操作日志</h1>
      <Card className="p-4 max-h-[70vh] overflow-auto">
        {db.logs.map((l) => (
          <div key={l.id} className="border-b py-1 text-xs flex gap-3">
            <span className="text-muted-foreground">{new Date(l.ts).toLocaleString()}</span>
            <span className="font-medium">{l.pid}</span>
            <span>{l.action}</span>
            <span className="text-muted-foreground">{l.detail}</span>
          </div>
        ))}
        {db.logs.length === 0 && <div className="text-sm text-muted-foreground">暂无日志</div>}
      </Card>
    </div>
  );
}
