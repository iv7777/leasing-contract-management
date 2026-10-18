import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { BrowserRouter } from "react-router-dom";
import "./i18n";
import { useTranslation } from "react-i18next";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { HelpProvider } from "./help/HelpContext";
import { appTheme } from "./theme";
import "./index.css";

function Root() {
  const { i18n } = useTranslation();
  const zh = i18n.language?.startsWith("zh");
  const antdLocale = zh ? zhCN : enUS;
  // The calendars take their month and weekday names from dayjs, not from antd's locale.
  dayjs.locale(zh ? "zh-cn" : "en");
  return (
    <ConfigProvider theme={appTheme} locale={antdLocale}>
      <BrowserRouter>
        <AuthProvider>
          <HelpProvider>
            <App />
          </HelpProvider>
        </AuthProvider>
      </BrowserRouter>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
