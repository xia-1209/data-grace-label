import { useEffect, useState } from "react";
import { DB, loadDB } from "./store";

export function useDB(): DB {
  const [db, setDB] = useState<DB>(() => loadDB());
  useEffect(() => {
    const h = () => setDB(loadDB());
    window.addEventListener("db-updated", h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener("db-updated", h);
      window.removeEventListener("storage", h);
    };
  }, []);
  return db;
}
