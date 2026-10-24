import { installScrollHints } from "../lib/scrollHints";
import { useEffect, useState, type ReactNode } from "react";
import { Layout, Menu, Drawer, Button, Dropdown, Grid, Space, Typography } from "antd";
import {
  DashboardOutlined,
  HomeOutlined,
  TeamOutlined,
  BankOutlined,
  UserOutlined,
  MenuOutlined,
  GlobalOutlined,
  LogoutOutlined,
  FileTextOutlined,
  BellOutlined,
  PieChartOutlined,
  AuditOutlined,
  CloudServerOutlined,
  ScheduleOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  EllipsisOutlined,
  SafetyCertificateOutlined,
  RocketOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Locale } from "@lcm/shared";
import { useAuth } from "../auth/AuthContext";
import { HelpDrawer } from "../help/HelpDrawer";

const { Header, Sider, Content } = Layout;
const { useBreakpoint } = Grid;

/** Marks the page so the stylesheet can size things for a phone held upright
 * (dev-phone) or on its side (dev-land: short and touch-driven, which still gets
 * the sidebar layout but needs a compact one). */
function useDeviceClasses() {
  useEffect(() => {
    const queries: [string, string][] = [
      ["dev-phone", "(max-width: 767px)"],
      ["dev-land", "(max-height: 500px) and (orientation: landscape) and (pointer: coarse)"],
    ];
    const cleanups = queries.map(([cls, q]) => {
      const mq = window.matchMedia(q);
      const apply = () => document.documentElement.classList.toggle(cls, mq.matches);
      apply();
      mq.addEventListener("change", apply);
      return () => {
        mq.removeEventListener("change", apply);
        document.documentElement.classList.remove(cls);
      };
    });
    return () => cleanups.forEach((c) => c());
  }, []);
}

const BOTTOM_NAV_KEYS = ["/", "/contracts", "/properties", "/reminders"];

export function AppLayout({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user, logout, setLocale } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useDeviceClasses();
  useEffect(() => installScrollHints(), []);

  const adminItems = [
    { key: "/users", icon: <UserOutlined />, label: t("nav.users") },
    { key: "/audit", icon: <AuditOutlined />, label: t("nav.audit") },
    { key: "/billing-runs", icon: <ScheduleOutlined />, label: t("nav.billingRuns") },
    { key: "/backups", icon: <CloudServerOutlined />, label: t("nav.backups") },
    { key: "/go-live", icon: <RocketOutlined />, label: t("nav.goLive") },
    { key: "/system-health", icon: <SafetyCertificateOutlined />, label: t("nav.systemHealth") },
  ];

  const items = [
    { key: "/", icon: <DashboardOutlined />, label: t("nav.dashboard") },
    { key: "/guide", icon: <ReadOutlined />, label: t("nav.guide") },
    { key: "/properties", icon: <HomeOutlined />, label: t("nav.properties") },
    { key: "/contracts", icon: <FileTextOutlined />, label: t("nav.contracts") },
    { key: "/reminders", icon: <BellOutlined />, label: t("nav.reminders") },
    { key: "/occupancy", icon: <PieChartOutlined />, label: t("nav.occupancy") },
    { key: "/tenants", icon: <TeamOutlined />, label: t("nav.tenants") },
    { key: "/landlords", icon: <BankOutlined />, label: t("nav.landlords") },
    ...(user?.role === "admin"
      ? [
          {
            key: "admin",
            icon: <ToolOutlined />,
            label: t("nav.admin"),
            children: adminItems,
          },
        ]
      : []),
  ];

  const selectedKey =
    [...items.filter((i) => !("children" in i)), ...adminItems].find((i) => i.key !== "/" && location.pathname.startsWith(i.key))?.key ?? "/";
  const inAdmin = adminItems.some((i) => i.key === selectedKey);
  const [openKeys, setOpenKeys] = useState<string[]>(inAdmin ? ["admin"] : []);
  useEffect(() => {
    if (inAdmin) setOpenKeys((keys) => (keys.includes("admin") ? keys : [...keys, "admin"]));
  }, [inAdmin]);

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
      openKeys={openKeys}
      onOpenChange={setOpenKeys}
      items={items}
      onClick={({ key }) => handleNavigate(key)}
      style={{ borderInlineEnd: "none" }}
    />
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider width={220} theme="light" style={{ borderInlineEnd: "1px solid #eee" }}>
          <div className="app-sider-title" style={{ padding: "16px 20px", fontWeight: 600, fontSize: 16 }}>{t("app.title")}</div>
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
            {isMobile && <Button className="app-icon-btn" type="text" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />}
            {isMobile && <Typography.Text strong className="app-title-mobile">{t("app.title")}</Typography.Text>}
          </Space>
          <Space>
            <Button className="app-icon-btn" type="text" icon={<QuestionCircleOutlined />} onClick={() => setHelpOpen(true)} aria-label={t("help.drawerTitle")} />
            <Dropdown menu={languageMenu}>
              <Button className="app-icon-btn" type="text" icon={<GlobalOutlined />}>
                <span className="desktop-only">{i18n.language?.startsWith("zh") ? "中文" : "EN"}</span>
              </Button>
            </Dropdown>
            {!isMobile && <Typography.Text>{user?.name}</Typography.Text>}
            <Button className="app-icon-btn" type="text" icon={<LogoutOutlined />} onClick={() => void logout()}>
              <span className="desktop-only">{t("nav.logout")}</span>
            </Button>
          </Space>
        </Header>

        <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={240} styles={{ body: { padding: 0 } }}>
          {nav}
        </Drawer>

        <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />

        <Content style={{ padding: isMobile ? 12 : 24, paddingBottom: isMobile ? 76 : 24 }}>{children}</Content>

        {isMobile && (
          <nav className="bottom-nav">
            {items
              .filter((i) => BOTTOM_NAV_KEYS.includes(i.key))
              .map((i) => (
                <button key={i.key} className={i.key === selectedKey ? "active" : ""} onClick={() => handleNavigate(i.key)}>
                  {i.icon}
                  <span>{i.label}</span>
                </button>
              ))}
            <button className={BOTTOM_NAV_KEYS.includes(selectedKey) ? "" : "active"} onClick={() => setDrawerOpen(true)}>
              <EllipsisOutlined />
              <span>{t("nav.more")}</span>
            </button>
          </nav>
        )}
      </Layout>
    </Layout>
  );
}
