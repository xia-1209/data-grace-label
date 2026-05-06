import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import Shell from "@/components/Shell";
import Login from "@/pages/Login";
import AnnotatorTasks from "@/pages/AnnotatorTasks";
import AnnotatorWorkbench from "@/pages/AnnotatorWorkbench";
import Reviewer from "@/pages/Reviewer";
import { AdminDashboard, AdminDatasets, AdminLibraries, AdminLogs, AdminRules, AdminTagPool, AdminTasks, AdminUsers } from "@/pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function Guard({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  if (user.role === "reviewer") return <Navigate to="/reviewer" replace />;
  return <Navigate to="/annotator" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Home />} />
            <Route path="/annotator" element={<Guard roles={["annotator"]}><Shell><AnnotatorTasks /></Shell></Guard>} />
            <Route path="/annotator/:taskId" element={<Guard roles={["annotator"]}><Shell><AnnotatorWorkbench /></Shell></Guard>} />
            <Route path="/reviewer" element={<Guard roles={["reviewer"]}><Shell><Reviewer /></Shell></Guard>} />
            <Route path="/admin" element={<Guard roles={["admin"]}><Shell><AdminDashboard /></Shell></Guard>} />
            <Route path="/admin/datasets" element={<Guard roles={["admin"]}><Shell><AdminDatasets /></Shell></Guard>} />
            <Route path="/admin/tasks" element={<Guard roles={["admin"]}><Shell><AdminTasks /></Shell></Guard>} />
            <Route path="/admin/users" element={<Guard roles={["admin"]}><Shell><AdminUsers /></Shell></Guard>} />
            <Route path="/admin/rules" element={<Guard roles={["admin"]}><Shell><AdminRules /></Shell></Guard>} />
            <Route path="/admin/libraries" element={<Guard roles={["admin"]}><Shell><AdminLibraries /></Shell></Guard>} />
            <Route path="/admin/tagpool" element={<Guard roles={["admin"]}><Shell><AdminTagPool /></Shell></Guard>} />
            <Route path="/admin/logs" element={<Guard roles={["admin"]}><Shell><AdminLogs /></Shell></Guard>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
