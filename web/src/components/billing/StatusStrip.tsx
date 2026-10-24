import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Typography, theme } from "antd";
import { CheckCircleFilled, DownOutlined, ExclamationCircleFilled, InfoCircleFilled } from "@ant-design/icons";

export interface StripItem {
  key: string;
  tone: "success" | "warning" | "info";
  /** The one line that is always visible. */
  title: ReactNode;
  /** Small grey text after the title, still on the one line. */
  hint?: ReactNode;
  /** A button kept on the collapsed row (its clicks do not open or close the row). */
  quick?: ReactNode;
  /** The full information, shown when the row is opened. */
  body: ReactNode;
}

const ICONS = { success: CheckCircleFilled, warning: ExclamationCircleFilled, info: InfoCircleFilled };

/** Status notices as one thin row each, side by side where there is room. Click a row to read it in full
 * (one at a time, in a panel under the rows); they all start folded. */
export default function StatusStrip({ items }: { items: StripItem[] }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState<string | null>(null);
  const shown = items.filter(Boolean);
  if (shown.length === 0) return null;
  const opened = shown.find((i) => i.key === open) ?? null;
  const colors = {
    success: { fg: token.colorSuccess, bg: token.colorSuccessBg, border: token.colorSuccessBorder },
    warning: { fg: token.colorWarning, bg: token.colorWarningBg, border: token.colorWarningBorder },
    info: { fg: token.colorInfo, bg: token.colorInfoBg, border: token.colorInfoBorder },
  };
  const toggle = (key: string) => setOpen((cur) => (cur === key ? null : key));

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {shown.map((i) => {
          const c = colors[i.tone];
          const Icon = ICONS[i.tone];
          const isOpen = i.key === open;
          const onKey = (e: KeyboardEvent) => {
            if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              toggle(i.key);
            }
          };
          return (
            <div
              key={i.key}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggle(i.key)}
              onKeyDown={onKey}
              style={{
                flex: "1 1 280px",
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 10px",
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderLeft: `3px solid ${c.fg}`,
                borderRadius: token.borderRadius,
                cursor: "pointer",
              }}
            >
              <Icon style={{ color: c.fg }} />
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Typography.Text strong>{i.title}</Typography.Text>
                {i.hint && (
                  <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {i.hint}
                  </Typography.Text>
                )}
              </div>
              {i.quick && <span onClick={(e) => e.stopPropagation()}>{i.quick}</span>}
              <DownOutlined style={{ fontSize: 10, color: token.colorTextTertiary, transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
            </div>
          );
        })}
      </div>
      {opened && (
        <div style={{ marginTop: 8, padding: "10px 12px", border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, background: token.colorBgContainer }}>{opened.body}</div>
      )}
    </div>
  );
}
