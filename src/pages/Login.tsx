import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export default function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [username, setU] = useState("admin");
  const [password, setP] = useState("admin");
  const [role, setR] = useState("admin");

  if (user) {
    nav("/", { replace: true });
  }

  const submit = () => {
    const err = login(username, password, role);
    if (err) toast.error(err);
    else {
      toast.success("登录成功");
      const target = role === "admin" ? "/admin" : role === "reviewer" ? "/reviewer" : "/annotator";
      nav(target, { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-soft to-background">
      <Card className="p-8 w-[400px] space-y-4">
        <h1 className="text-2xl font-bold text-center">服装多库标注平台</h1>
        <p className="text-sm text-center text-muted-foreground">演示账号：admin/admin · annotator1/123 · annotator2/123 · reviewer1/123</p>
        <div className="space-y-2">
          <label className="text-sm">用户名</label>
          <Input value={username} onChange={(e) => setU(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm">密码</label>
          <Input type="password" value={password} onChange={(e) => setP(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm">角色</label>
          <div className="flex gap-2">
            {["admin", "annotator", "reviewer"].map((r) => (
              <button
                key={r}
                onClick={() => setR(r)}
                className={`flex-1 py-2 rounded border text-sm ${role === r ? "bg-primary text-primary-foreground border-primary" : ""}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Button className="w-full" onClick={submit}>登录</Button>
      </Card>
    </div>
  );
}
