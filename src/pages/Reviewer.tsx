import { useState } from "react";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERSPECTIVES, PERSPECTIVE_LABEL, log, loadDB, saveDB } from "@/lib/store";
import { toast } from "sonner";

export default function Reviewer() {
  const db = useDB();
  const { user } = useAuth();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (!user) return null;
  const myTasks = db.tasks.filter((t) => t.reviewers.includes(user.pid));
  const task = myTasks.find((t) => t.id === taskId);
  const dataset = task ? db.datasets.find((d) => d.id === task.datasetId) : null;

  const setStatus = (annoId: string, status: "approved" | "rejected") => {
    const dbX = loadDB();
    const idx = dbX.annotations.findIndex((a) => a.id === annoId);
    if (idx < 0) return;
    dbX.annotations[idx].status = status;
    dbX.annotations[idx].reviewerPid = user.pid;
    if (status === "rejected") dbX.annotations[idx].rejectReason = reasons[annoId] || "";
    dbX.annotations[idx].history.push({ ts: Date.now(), status, by: user.pid, reason: reasons[annoId] });
    saveDB(dbX);
    log(status === "approved" ? "approve" : "reject", user.pid, `anno=${annoId}`);
    toast.success(status === "approved" ? "已通过" : "已打回");
  };

  if (!task) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">待审核任务</h1>
        <div className="grid grid-cols-2 gap-4">
          {myTasks.map((t) => {
            const pending = db.annotations.filter((a) => a.taskId === t.id && a.status === "submitted").length;
            return (
              <Card key={t.id} className="p-4 space-y-2">
                <h3 className="font-semibold">{t.name}</h3>
                <div className="text-sm text-muted-foreground">待审核 {pending} 条</div>
                <Button size="sm" onClick={() => setTaskId(t.id)}>进入审核</Button>
              </Card>
            );
          })}
          {myTasks.length === 0 && <p className="text-muted-foreground">暂无任务</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => setTaskId(null)}>← 返回任务列表</Button>
      <h1 className="text-2xl font-bold my-3">{task.name}</h1>
      <div className="space-y-4">
        {dataset?.images.map((img) => (
          <Card key={img.id} className="p-4 flex gap-4">
            <img src={img.url} className="w-40 h-40 object-cover rounded" alt="" />
            <div className="flex-1 space-y-2">
              <div className="text-sm font-medium">{img.filename}</div>
              {PERSPECTIVES.map((p) => {
                const a = db.annotations.find((x) => x.taskId === task.id && x.imageId === img.id && x.perspective === p);
                if (!a) return null;
                return (
                  <div key={p} className="border rounded p-2 bg-muted/30">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium">{PERSPECTIVE_LABEL[p]} <span className="text-xs text-muted-foreground">[{a.status}]</span></div>
                      {a.status === "submitted" && (
                        <div className="flex gap-2">
                          <Input placeholder="打回原因" className="h-7 w-40 text-xs" value={reasons[a.id] || ""} onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))} />
                          <Button size="sm" variant="outline" onClick={() => setStatus(a.id, "rejected")}>打回</Button>
                          <Button size="sm" onClick={() => setStatus(a.id, "approved")}>通过</Button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs mt-1">{JSON.stringify(a.data)}</div>
                    {a.craftPartGroups && a.craftPartGroups.length > 0 && (
                      <div className="text-xs text-muted-foreground">工艺-部位：{JSON.stringify(a.craftPartGroups)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
