import { useState } from "react";
import { Link } from "react-router-dom";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AnnoStatus, PERSPECTIVES } from "@/lib/store";

export default function AnnotatorTasks() {
  const db = useDB();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  if (!user) return null;
  const myTasks = db.tasks.filter((t) => t.annotators.some((a) => a.userPid === user.pid) && t.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">我的任务</h1>
        <Input placeholder="搜索任务名称…" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {myTasks.map((t) => {
          const ds = db.datasets.find((d) => d.id === t.datasetId);
          const lib = db.libraries.find((l) => l.key === t.libraryKey);
          const myPerspectives = t.annotators.find((a) => a.userPid === user.pid)?.perspectives || [];
          // image-level rollup status
          const imgStatuses = (ds?.styles || []).map((s) => {
            const annos = myPerspectives.map((p) => db.annotations.find((a) => a.taskId === t.id && a.styleId === s.id && a.perspective === p));
            if (annos.every((a) => !a)) return "not_started";
            if (annos.some((a) => a?.status === "rejected")) return "rejected";
            if (annos.some((a) => a?.status === "submitted")) return "submitted";
            if (annos.some((a) => a?.status === "approved") && annos.every((a) => !a || a.status === "approved")) return "approved";
            if (annos.some((a) => a?.status === "drafted")) return "drafted";
            return "not_started";
          });
          const cnt = (s: AnnoStatus) => imgStatuses.filter((x) => x === s).length;
          const total = imgStatuses.length;
          return (
            <Card key={t.id} className="p-4 space-y-2">
              <div className="flex justify-between">
                <h3 className="font-semibold">{t.name}</h3>
                <span className="text-xs text-muted-foreground">截止 {t.deadline}</span>
              </div>
              <div className="text-sm text-muted-foreground">库类型：<span className="font-medium text-foreground">{lib?.name}</span> · 数据集：{ds?.name}</div>
              <div className="text-xs">我的视角：{myPerspectives.join(", ")}</div>
              <div className="grid grid-cols-5 gap-1 text-xs">
                <Stat label="未打标" value={cnt("not_started")} color="bg-muted" />
                <Stat label="草稿" value={cnt("drafted")} color="bg-amber-100 text-amber-900" />
                <Stat label="待审核" value={cnt("submitted")} color="bg-blue-100 text-blue-900" />
                <Stat label="已通过" value={cnt("approved")} color="bg-green-100 text-green-900" />
                <Stat label="已打回" value={cnt("rejected")} color="bg-red-100 text-red-900" />
              </div>
              <div className="text-xs text-muted-foreground">共 {total} 个款式</div>
              <Link to={`/annotator/${t.id}?status=not_started`}>
                <Button size="sm" className="w-full">开始标注</Button>
              </Link>
            </Card>
          );
        })}
        {myTasks.length === 0 && <p className="text-muted-foreground">暂无任务</p>}
      </div>
    </div>
  );
}

const Stat = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className={`rounded p-1 text-center ${color}`}>
    <div className="font-bold">{value}</div>
    <div className="text-[10px]">{label}</div>
  </div>
);
