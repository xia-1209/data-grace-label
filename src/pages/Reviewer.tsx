import { useMemo, useState } from "react";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnnoStatus, PERSPECTIVES, PERSPECTIVE_LABEL, log, loadDB, saveDB } from "@/lib/store";
import { toast } from "sonner";

export default function Reviewer() {
  const db = useDB();
  const { user } = useAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"submitted" | "approved" | "rejected">("submitted");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (!user) return null;
  const myTasks = db.tasks.filter((t) => t.reviewers.includes(user.pid) && t.name.toLowerCase().includes(search.toLowerCase()));
  const task = myTasks.find((t) => t.id === taskId);
  const dataset = task ? db.datasets.find((d) => d.id === task.datasetId) : null;

  const setStatus = (annoId: string, status: "approved" | "rejected", reason?: string) => {
    const dbX = loadDB();
    const idx = dbX.annotations.findIndex((a) => a.id === annoId);
    if (idx < 0) return;
    dbX.annotations[idx].status = status;
    dbX.annotations[idx].reviewerPid = user.pid;
    if (status === "rejected") dbX.annotations[idx].rejectReason = reason || reasons[annoId] || "";
    dbX.annotations[idx].history.push({ ts: Date.now(), status, by: user.pid, reason });
    saveDB(dbX);
    log(status === "approved" ? "approve" : "reject", user.pid, `anno=${annoId}`);
  };

  const batch = (status: "approved" | "rejected") => {
    let reason = "";
    if (status === "rejected") {
      reason = prompt("批量打回原因") || "";
      if (!reason) return;
    }
    selected.forEach((id) => setStatus(id, status, reason));
    toast.success(`批量${status === "approved" ? "通过" : "打回"} ${selected.size} 条`);
    setSelected(new Set());
  };

  if (!task) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">待审核任务</h1>
          <Input placeholder="搜索任务…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          {myTasks.map((t) => {
            const pending = db.annotations.filter((a) => a.taskId === t.id && a.status === "submitted").length;
            const approved = db.annotations.filter((a) => a.taskId === t.id && a.status === "approved").length;
            const rejected = db.annotations.filter((a) => a.taskId === t.id && a.status === "rejected").length;
            return (
              <Card key={t.id} className="p-4 space-y-2">
                <h3 className="font-semibold">{t.name}</h3>
                <div className="text-xs text-muted-foreground">数据集：{db.datasets.find(d => d.id === t.datasetId)?.name}</div>
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

  const annosByStyle = (dataset?.styles || []).map((s) => ({
    style: s,
    annos: PERSPECTIVES.map((p) => db.annotations.find((x) => x.taskId === task.id && x.styleId === s.id && x.perspective === p))
      .filter(Boolean)
      .filter((a) => a!.status === filter),
  })).filter((x) => x.annos.length > 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => setTaskId(null)}>← 返回</Button>
      <div className="flex justify-between items-center my-3">
        <h1 className="text-2xl font-bold">{task.name}</h1>
        <div className="flex gap-1">
          {(["submitted", "approved", "rejected"] as const).map((s) => (
            <button key={s}
              onClick={() => { setFilter(s); setSelected(new Set()); }}
              className={`text-xs px-3 py-1 rounded ${filter === s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              {s === "submitted" ? "待审核" : s === "approved" ? "已通过" : "已打回"}
            </button>
          ))}
        </div>
      </div>
      {selected.size > 0 && filter === "submitted" && (
        <div className="sticky top-14 bg-card border rounded p-2 mb-3 flex gap-2 items-center z-10">
          <span className="text-sm">已选 {selected.size} 条</span>
          <Button size="sm" onClick={() => batch("approved")}>批量通过</Button>
          <Button size="sm" variant="destructive" onClick={() => batch("rejected")}>批量打回</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>清空</Button>
        </div>
      )}
      <div className="space-y-4">
        {annosByStyle.map(({ style, annos }) => (
          <Card key={style.id} className="p-4 flex gap-4">
            <div className="flex flex-col gap-1">
              {style.images.slice(0, 2).map((im, i) => (
                <img key={i} src={im.url} className="w-32 h-32 object-cover rounded" alt="" />
              ))}
            </div>
            <div className="flex-1 space-y-2">
              <div className="text-sm font-medium">款式 {style.styleId} <span className="text-xs text-muted-foreground">({style.images.length} 图)</span></div>
              {annos.map((a) => a && (
                <div key={a.id} className="border rounded p-2 bg-muted/30">
                  <div className="flex justify-between items-center gap-2">
                    <div className="text-sm font-medium flex items-center gap-2">
                      {filter === "submitted" && (
                        <input type="checkbox" checked={selected.has(a.id)} onChange={(e) => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(a.id); else s.delete(a.id);
                          setSelected(s);
                        }} />
                      )}
                      {PERSPECTIVE_LABEL[a.perspective]} <span className="text-xs text-muted-foreground">[{a.status}]</span>
                    </div>
                    {filter === "submitted" && (
                      <div className="flex gap-2">
                        <Input placeholder="打回原因" className="h-7 w-40 text-xs" value={reasons[a.id] || ""} onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))} />
                        <Button size="sm" variant="outline" onClick={() => { setStatus(a.id, "rejected"); toast.success("已打回"); }}>打回</Button>
                        <Button size="sm" onClick={() => { setStatus(a.id, "approved"); toast.success("已通过"); }}>通过</Button>
                        <Button size="sm" variant="ghost" onClick={() => {
                          const note = prompt("内部备注（不发给标注员）"); if (!note) return;
                          const x = loadDB(); const i = x.annotations.findIndex((xx) => xx.id === a.id);
                          if (i >= 0) { x.annotations[i].reviewerNotes = [...(x.annotations[i].reviewerNotes || []), note]; saveDB(x); toast.success("备注已添加"); }
                        }}>备注</Button>
                      </div>
                    )}
                  </div>
                  <div className="text-xs mt-1 break-all">{JSON.stringify(a.data)}</div>
                  {a.craftPartGroups && a.craftPartGroups.length > 0 && (
                    <div className="text-xs text-muted-foreground">工艺-部位：{JSON.stringify(a.craftPartGroups)}</div>
                  )}
                  {a.rejectReason && <div className="text-xs text-red-700">打回原因：{a.rejectReason}</div>}
                  {a.reviewerNotes && a.reviewerNotes.length > 0 && (
                    <div className="text-xs text-muted-foreground">内部备注：{a.reviewerNotes.join(" | ")}</div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))}
        {annosByStyle.length === 0 && <div className="text-muted-foreground">暂无该状态的标注</div>}
      </div>
    </div>
  );
}
