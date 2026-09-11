import type { ThemeConfig } from "antd";

/** Restrained, professional palette for a financial back-office app —
 * generous whitespace, subtle borders instead of heavy shadows, a muted
 * accent rather than a loud brand color. */
export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1f5f4a",
    colorLink: "#1f5f4a",
    colorSuccess: "#2e7d32",
    colorWarning: "#b8860b",
    colorError: "#b3423a",
    borderRadius: 8,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    colorBgLayout: "#f6f7f5",
  },
  components: {
    Layout: {
      headerBg: "#ffffff",
      siderBg: "#ffffff",
      bodyBg: "#f6f7f5",
    },
    Menu: {
      itemSelectedBg: "#e7f0ec",
      itemSelectedColor: "#1f5f4a",
    },
    Card: {
      boxShadowTertiary: "none",
    },
    Table: {
      headerBg: "#fafafa",
    },
  },
};
