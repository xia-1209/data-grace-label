import React, { createContext, useContext, useEffect, useState } from "react";
import { loadDB, User, Role, log } from "./store";

interface AuthCtx {
  user: User | null;
  activeRole: Role | null;
  setActiveRole: (r: Role) => void;
  login: (username: string, password: string) => string | null;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  activeRole: null,
  setActiveRole: () => {},
  login: () => null,
  logout: () => {},
});
const KEY = "garment_anno_session";

interface Session { user: User; activeRole: Role }

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      // migrate legacy session shape
      if (s.user && !s.user.roles && s.user.role) s.user.roles = [s.user.role];
      if (s.user && !s.activeRole) s.activeRole = s.user.roles?.[0] || "annotator";
      return s;
    } catch { return null; }
  });

  useEffect(() => {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  }, [session]);

  const login = (username: string, password: string) => {
    const db = loadDB();
    const u = db.users.find((x) => x.username === username && x.password === password);
    if (!u) return "用户名或密码错误";
    if (!u.roles || u.roles.length === 0) return "该用户未分配角色";
    setSession({ user: u, activeRole: u.roles[0] });
    log("login", u.pid);
    return null;
  };
  const logout = () => {
    if (session?.user) log("logout", session.user.pid);
    setSession(null);
  };
  const setActiveRole = (r: Role) => {
    setSession((s) => (s && s.user.roles.includes(r) ? { ...s, activeRole: r } : s));
  };

  return (
    <Ctx.Provider value={{
      user: session?.user || null,
      activeRole: session?.activeRole || null,
      setActiveRole,
      login,
      logout,
    }}>
      {children}
    </Ctx.Provider>
  );
};

export const useAuth = () => useContext(Ctx);
