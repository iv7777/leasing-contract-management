import { Drawer, Typography, List } from "antd";
import { ReadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useHelp } from "./HelpContext";
import { topicFallbackChain } from "./registry";

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { topic } = useHelp();
  const navigate = useNavigate();

  const resolvedTopic = topicFallbackChain(topic).find((key) => i18n.exists(`help.${key}.title`)) ?? topic;
  const titleKey = `help.${resolvedTopic}.title`;
  const bodyKey = `help.${resolvedTopic}.body`;
  const tipsKey = `help.${resolvedTopic}.tips`;

  const hasContent = i18n.exists(titleKey);
  const tipsText = i18n.exists(tipsKey) ? t(tipsKey) : "";
  const tips = tipsText ? tipsText.split("\n").filter(Boolean) : [];

  return (
    <Drawer title={t("help.drawerTitle")} open={open} onClose={onClose} width={420}>
      {topic !== "guide" && (
        <Typography.Link
          onClick={() => {
            onClose();
            navigate("/guide");
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 16 }}
        >
          <ReadOutlined /> {t("help.guideLinkText")}
        </Typography.Link>
      )}
      {hasContent ? (
        <>
          <Typography.Title level={5}>{t(titleKey)}</Typography.Title>
          <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>{t(bodyKey)}</Typography.Paragraph>
          {tips.length > 0 && (
            <>
              <Typography.Text strong>{t("help.tipsHeading")}</Typography.Text>
              <List
                size="small"
                dataSource={tips}
                renderItem={(tip) => <List.Item style={{ paddingInlineStart: 0 }}>{tip}</List.Item>}
              />
            </>
          )}
        </>
      ) : (
        <Typography.Paragraph type="secondary">{t("help.noContent")}</Typography.Paragraph>
      )}
    </Drawer>
  );
}
