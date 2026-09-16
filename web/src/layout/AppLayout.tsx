import { useState, type ReactNode } from "react";
import { Layout, Menu, Drawer, Button, Dropdown, Grid, Space, Typography } from "antd";
import {
  DashboardOutlined,
  HomeOutlined,
  TeamOutlined,
  UserOutlined,
  MenuOutlined,
  GlobalOutlined,
  LogoutOutlined,
  FileTextOutlined,
  BellOutlined,
  PieChartOutlined,
  AuditOutlined,
  CloudServerOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Locale } from "@lcm/shared";
import { useAuth } from "../auth/AuthContext";
import { HelpDrawer } from "../help/HelpDrawer";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

export function AppLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout, setLocale } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const items = [
    { key: "/", icon: <DashboardOutlined />, label: t("nav.dashboard") },
    { key: "/guide", icon: <ReadOutlined />, label: t("nav.guide") },
    { key: "/properties", icon: <HomeOutlined />, label: t("nav.properties") },
    { key: "/contracts", icon: <FileTextOutlined />, label: t("nav.contracts") },
    { key: "/reminders", icon: <BellOutlined />, label: t("nav.reminders") },
    { key: "/occupancy", icon: <PieChartOutlined />, label: t("nav.occupancy") },
    { key: "/parties", icon: <TeamOutlined />, label: t("nav.parties") },
    ...(user?.role === "admin" ? [{ key: "/users", icon: <UserOutlined />, label: t("nav.users") }] : []),
    ...(user?.role === "admin" ? [{ key: "/audit", icon: <AuditOutlined />, label: t("nav.audit") }] : []),
    ...(user?.role === "admin" ? [{ key: "/backups", icon: <CloudServerOutlined />, label: t("nav.backups") }] : []),
  ];

  const selectedKey =
    items.find((i) => i.key !== "/" && location.pathname.startsWith(i.key))?.key ?? "/";

  const handleNavigate = (key: string) => {
    navigate(key);
    setDrawerOpen(false);
  };

  const languageMenu = {
    items: [
      { key: "en", label: t("users.localeEn") },
      { key: "zh", label: t("users.localeZh") },
      { key: "auto", label: t("users.localeAuto") },
    ],
    onClick: ({ key }: { key: string }) => void setLocale(key as Locale),
  };

  const nav = (
    <Menu
      mode="inline"
      selectedKeys={[selectedKey]}
      items={items}
      onClick={({ key }) => handleNavigate(key)}
      style={{ borderInlineEnd: "none" }}
    />
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider width={220} theme="light" style={{ borderInlineEnd: "1px solid #eee" }}>
          <div style={{ padding: "16px 20px", fontWeight: 600, fontSize: 16 }}>{t("app.title")}</div>
          {nav}
        </Sider>
      )}

      <Layout>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 16px",
            borderBottom: "1px solid #eee",
          }}
        >
          <Space>
            {isMobile && <Button type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />}
            {isMobile && <Typography.Text strong>{t("app.title")}</Typography.Text>}
          </Space>
          <Space>
            <Button type="text" icon={<QuestionCircleOutlined />} onClick={() => setHelpOpen(true)} aria-label={t("help.drawerTitle")} />
            <Dropdown menu={languageMenu}>
              <Button type="text" icon={<GlobalOutlined />}>
                <span className="desktop-only">{i18n.language?.startsWith("zh") ? "中文" : "EN"}</span>
              </Button>
            </Dropdown>
            <Typography.Text className="desktop-only">{user?.name}</Typography.Text>
            <Button type="text" icon={<LogoutOutlined />} onClick={() => void logout()}>
              <span className="desktop-only">{t("nav.logout")}</span>
            </Button>
          </Space>
        </Header>

        <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={240} styles={{ body: { padding: 0 } }}>
          {nav}
        </Drawer>

        <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />

        <Content style={{ padding: isMobile ? 12 : 24, paddingBottom: isMobile ? 72 : 24 }}>{children}</Content>

        {isMobile && (
          <Menu
            mode="horizontal"
            selectedKeys={[selectedKey]}
            items={items}
            onClick={({ key }) => handleNavigate(key)}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              justifyContent: "space-around",
              borderTop: "1px solid #eee",
            }}
          />
        )}
      </Layout>
    </Layout>
  );
}
