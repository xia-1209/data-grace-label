import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { resetDemo, Role } from "@/lib/store";
import { toast } from "sonner";

const ROLE_LABEL: Record<Role, string> = {
  annotator: "标注员",
  reviewer: "审核员",
  admin: "管理员",
};

export default function Shell({ children }: { children: React.ReactNode }) {
  const { user, activeRole, setActiveRole, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  if (!user || !activeRole) return <>{children}</>;

  const links: { to: string; label: string; roles: string[] }[] = [
    { to: "/annotator", label: "我的任务", roles: ["annotator"] },
    { to: "/reviewer", label: "审核工作台", roles: ["reviewer"] },
    { to: "/admin", label: "仪表盘", roles: ["admin"] },
    { to: "/admin/datasets", label: "数据集", roles: ["admin"] },
    { to: "/admin/tasks", label: "任务", roles: ["admin"] },
    { to: "/admin/users", label: "用户", roles: ["admin"] },
    { to: "/admin/rules", label: "打标规则", roles: ["admin"] },
    { to: "/admin/libraries", label: "库管理", roles: ["admin"] },
    { to: "/admin/tagpool", label: "标签池", roles: ["admin"] },
    { to: "/admin/logs", label: "操作日志", roles: ["admin"] },
  ].filter((l) => l.roles.includes(activeRole));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="flex items-center gap-4 px-4 h-14">
          <div className="font-bold text-primary">服装标注平台</div>
          <nav className="flex gap-1 flex-1 overflow-x-auto">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-1.5 rounded text-sm whitespace-nowrap ${
                  loc.pathname.startsWith(l.to) ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm("确认重置演示数据？所有改动将丢失。")) {
                resetDemo();
                toast.success("演示数据已重置");
                setTimeout(() => location.reload(), 300);
              }
            }}
          >
            重置演示数据
          </Button>
          {user.roles.length > 1 ? (
            <select
              className="border rounded px-2 py-1 text-sm"
              value={activeRole}
              onChange={(e) => {
                const r = e.target.value as Role;
                setActiveRole(r);
                const target = r === "admin" ? "/admin" : r === "reviewer" ? "/reviewer" : "/annotator";
                nav(target);
              }}
            >
              {user.roles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          ) : null}
          <div className="text-sm">
            <span className="font-medium">{user.username}</span>
            <span className="text-muted-foreground ml-1">({ROLE_LABEL[activeRole]} · {user.pid})</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { logout(); nav("/login"); }}>登出</Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
