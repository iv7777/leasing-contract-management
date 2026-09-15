import { Navigate, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import type { Role } from "@lcm/shared";
import { useAuth } from "./auth/AuthContext";
import { AppLayout } from "./layout/AppLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import GuidePage from "./pages/GuidePage";
import PropertiesPage from "./pages/PropertiesPage";
import PropertyDetailPage from "./pages/PropertyDetailPage";
import ContractsPage from "./pages/ContractsPage";
import ContractDetailPage from "./pages/ContractDetailPage";
import PartiesPage from "./pages/PartiesPage";
import RemindersPage from "./pages/RemindersPage";
import OccupancyPage from "./pages/OccupancyPage";
import UsersPage from "./pages/UsersPage";
import AuditLogPage from "./pages/AuditLogPage";
import BackupsPage from "./pages/BackupsPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireRole({ roles, children }: { roles: Role[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/guide" element={<GuidePage />} />
                <Route path="/properties" element={<PropertiesPage />} />
                <Route path="/properties/:id" element={<PropertyDetailPage />} />
                <Route path="/contracts" element={<ContractsPage />} />
                <Route path="/contracts/:id" element={<ContractDetailPage />} />
                <Route path="/parties" element={<PartiesPage />} />
                <Route path="/reminders" element={<RemindersPage />} />
                <Route path="/occupancy" element={<OccupancyPage />} />
                <Route
                  path="/users"
                  element={
                    <RequireRole roles={["admin"]}>
                      <UsersPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <RequireRole roles={["admin"]}>
                      <AuditLogPage />
                    </RequireRole>
                  }
                />
                <Route
                  path="/backups"
                  element={
                    <RequireRole roles={["admin"]}>
                      <BackupsPage />
                    </RequireRole>
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppLayout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
