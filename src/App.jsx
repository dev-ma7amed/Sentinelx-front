import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Alerts from "./pages/Alerts";
import IncidentList from "./pages/IncidentList";
import IncidentPage from "./pages/IncidentPage";
import Intelligence from "./pages/Intelligence";
import Cases from "./pages/Cases";
import AuditMetrics from "./pages/AuditMetrics";
import Settings from "./pages/Settings";
import { LS_AUTH, getCurrentUser } from "./session";
import { ensureSocProfileDefaults } from "./socProfile";
import { hydrateSocPipeline } from "./platformStore";
import "./styles/enterprise.css";

function RequireAuth({ children, allowedRoles }) {
  useEffect(() => {
    ensureSocProfileDefaults();
  }, []);
  if (typeof window !== "undefined") {
    if (localStorage.getItem(LS_AUTH) !== "true" || !getCurrentUser()) {
      return <Navigate to="/" replace />;
    }
    if (allowedRoles) {
      const user = getCurrentUser();
      const roleType = (user?.roleType || "analyst").toLowerCase();
      if (!allowedRoles.includes(roleType)) {
        return <Navigate to="/dashboard" replace />;
      }
    }
  }
  return children;
}

export default function App() {
  useEffect(() => {
    hydrateSocPipeline();

    // Initialize authoritative state after hydration
    setTimeout(() => {
      if (typeof window !== "undefined" && window.initializeAuthoritativeState) {
        window.initializeAuthoritativeState();
      }
    }, 100);
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/alerts" element={<RequireAuth allowedRoles={["admin", "analyst"]}><Alerts /></RequireAuth>} />
      <Route path="/logs" element={<RequireAuth allowedRoles={["admin", "analyst"]}><Alerts view="logs" /></RequireAuth>} />
      <Route path="/incidents" element={<RequireAuth><IncidentList /></RequireAuth>} />
      <Route path="/incident/:id" element={<RequireAuth><IncidentPage /></RequireAuth>} />
      <Route path="/incident" element={<RequireAuth><IncidentPage /></RequireAuth>} />
      <Route path="/intelligence" element={<RequireAuth allowedRoles={["admin", "analyst"]}><Intelligence /></RequireAuth>} />
      <Route path="/cases" element={<RequireAuth allowedRoles={["admin", "analyst"]}><Cases /></RequireAuth>} />
      <Route path="/audit" element={<RequireAuth allowedRoles={["admin"]}><AuditMetrics /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth allowedRoles={["admin"]}><Settings /></RequireAuth>} />
      <Route path="/Settings" element={<Navigate to="/settings" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}