import { Fragment, type ReactNode } from "react";
import { Drawer, Typography, List } from "antd";
import { ReadOutlined, RightOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useHelp } from "./HelpContext";
import { helpMore } from "./helpMore";
import { guideChaptersForTopic, topicFallbackChain } from "./registry";
import { guideEn } from "../guide/content.en";
import { guideZh } from "../guide/content.zh";

/** **bold** and `code` in help text. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <Typography.Text code key={i}>{part.slice(1, -1)}</Typography.Text>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function HelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { topic } = useHelp();
  const navigate = useNavigate();
  const lang = i18n.language?.startsWith("zh") ? "zh" : "en";
  const extra = helpMore[lang];
  const guide = lang === "zh" ? guideZh : guideEn;

  const chain = topicFallbackChain(topic);
  // The nearest topic with content of its own (a translation, or full text in helpMore).
  const contentKey = chain.find((key) => i18n.exists(`help.${key}.title`) || extra[key]?.title) ?? topic;
  const own = extra[contentKey];
  const hasContent = i18n.exists(`help.${contentKey}.title`) || !!own?.title;

  const title = own?.title ?? (i18n.exists(`help.${contentKey}.title`) ? t(`help.${contentKey}.title`) : "");
  const body = own?.body ?? (i18n.exists(`help.${contentKey}.body`) ? t(`help.${contentKey}.body`) : "");
  const tipsKey = `help.${contentKey}.tips`;
  const tips = own?.tips ?? (i18n.exists(tipsKey) ? t(tipsKey).split("\n").filter(Boolean) : []);
  const steps = chain.map((key) => extra[key]?.steps).find(Boolean) ?? [];

  const chapters = guideChaptersForTopic(topic)
    .map((id) => guide.chapters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const openChapter = (id: string) => {
    onClose();
    navigate(`/guide#${id}`);
  };

  return (
    <Drawer title={t("help.drawerTitle")} open={open} onClose={onClose} width={420}>
      {hasContent ? (
        <>
          <Typography.Title level={5}>{title}</Typography.Title>
          <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>{body}</Typography.Paragraph>
          {steps.length > 0 && (
            <>
              <Typography.Text strong>{t("help.stepsHeading")}</Typography.Text>
              <ol style={{ paddingInlineStart: 20, margin: "8px 0 16px" }}>
                {steps.map((step, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {inline(step)}
                  </li>
                ))}
              </ol>
            </>
          )}
          {tips.length > 0 && (
            <>
              <Typography.Text strong>{t("help.tipsHeading")}</Typography.Text>
              <List size="small" dataSource={tips} renderItem={(tip) => <List.Item style={{ paddingInlineStart: 0 }}>{tip}</List.Item>} />
            </>
          )}
        </>
      ) : (
        <Typography.Paragraph type="secondary">{t("help.noContent")}</Typography.Paragraph>
      )}

      {chapters.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 12, borderTop: "1px solid #eee" }}>
          <Typography.Text strong>
            <ReadOutlined /> {t("help.learnMore")}
          </Typography.Text>
          <List
            size="small"
            style={{ marginTop: 6 }}
            dataSource={chapters}
            renderItem={(c) => (
              <List.Item style={{ paddingInlineStart: 0, cursor: "pointer" }} onClick={() => openChapter(c.id)}>
                <Typography.Link>
                  {c.title} <RightOutlined style={{ fontSize: 10 }} />
                </Typography.Link>
              </List.Item>
            )}
          />
        </div>
      )}
    </Drawer>
  );
}
