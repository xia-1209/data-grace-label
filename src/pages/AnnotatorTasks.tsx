import { Link } from "react-router-dom";
import { useDB } from "@/lib/useDB";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export default function AnnotatorTasks() {
  const db = useDB();
  const { user } = useAuth();
  if (!user) return null;
  const myTasks = db.tasks.filter((t) => t.annotators.some((a) => a.userPid === user.pid));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">我的任务</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {myTasks.map((t) => {
          const ds = db.datasets.find((d) => d.id === t.datasetId);
          const lib = db.libraries.find((l) => l.key === t.libraryKey);
          const myPerspectives = t.annotators.find((a) => a.userPid === user.pid)?.perspectives || [];
          const total = (ds?.images.length || 0) * myPerspectives.length;
          const done = db.annotations.filter(
            (a) =>
              a.taskId === t.id &&
              a.annotatorPid === user.pid &&
              ["submitted", "approved"].includes(a.status),
          ).length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <Card key={t.id} className="p-4 space-y-2">
              <div className="flex justify-between">
                <h3 className="font-semibold">{t.name}</h3>
                <span className="text-xs text-muted-foreground">截止 {t.deadline}</span>
              </div>
              <div className="text-sm text-muted-foreground">库：{lib?.name} · 数据集：{ds?.name}</div>
              <div className="text-xs">我的视角：{myPerspectives.join(", ")}</div>
              <div className="text-xs">已提交：{done}/{total}</div>
              <Progress value={pct} />
              <Link to={`/annotator/${t.id}`}>
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
