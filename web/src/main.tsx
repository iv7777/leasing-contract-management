import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import "./i18n";
import { useTranslation } from "react-i18next";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { appTheme } from "./theme";
import "./index.css";

function Root() {
  const { i18n } = useTranslation();
  const antdLocale = i18n.language?.startsWith("zh") ? zhCN : enUS;
  return (
    <ConfigProvider theme={appTheme} locale={antdLocale}>
      <BrowserRouter>
        <AuthProvider>
          <App />
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
