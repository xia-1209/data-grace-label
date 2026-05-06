import React, { createContext, useContext, useEffect, useState } from "react";
import { loadDB, User, log } from "./store";

interface AuthCtx {
  user: User | null;
  login: (username: string, password: string, role: string) => string | null;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({ user: null, login: () => null, logout: () => {} });
const KEY = "garment_anno_session";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => {
    if (user) localStorage.setItem(KEY, JSON.stringify(user));
    else localStorage.removeItem(KEY);
  }, [user]);

  const login = (username: string, password: string, role: string) => {
    const db = loadDB();
    const u = db.users.find((x) => x.username === username && x.password === password && x.role === role);
    if (!u) return "用户名/密码/角色不匹配";
    setUser(u);
    log("login", u.pid);
    return null;
  };
  const logout = () => {
    if (user) log("logout", user.pid);
    setUser(null);
  };

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
};

export const useAuth = () => useContext(Ctx);
