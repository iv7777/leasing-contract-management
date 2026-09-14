import { Popover } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

/**
 * Small inline "?" affordance for a single confusing field. Renders nothing
 * if no help.field.<fieldKey> translation exists, so it's safe to add
 * speculatively without needing a matching i18n entry in both languages yet.
 */
export function HelpIcon({ field }: { field: string }) {
  const { t, i18n } = useTranslation();
  const key = `help.field.${field}`;
  if (!i18n.exists(key)) return null;
  return (
    <Popover content={<div style={{ maxWidth: 280 }}>{t(key)}</div>} trigger="click">
      <QuestionCircleOutlined style={{ marginInlineStart: 6, color: "rgba(0,0,0,0.45)", cursor: "pointer" }} />
    </Popover>
  );
}
