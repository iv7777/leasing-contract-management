import { Typography } from "antd";
import { useTranslation } from "react-i18next";
import { lineParts, type AmendmentLine } from "./amendmentText";

/** What an amendment changes, one short line each: old value struck-through red, new value green. */
export default function AmendmentLines({ lines, max }: { lines: AmendmentLine[]; max?: number }) {
  const { t } = useTranslation();
  if (lines.length === 0) return null;
  const shown = max ? lines.slice(0, max) : lines;
  return (
    <div style={{ fontSize: 13 }}>
      {shown.map((l, i) => {
        const p = lineParts(t, l);
        return (
          <div key={i}>
            <Typography.Text strong>{p.what}</Typography.Text>
            {p.before !== undefined && p.after !== undefined ? (
              <>
                : <span style={{ color: "#cf1322" }}>{p.before}</span> → <span style={{ color: "#389e0d" }}>{p.after}</span>
              </>
            ) : p.after !== undefined || p.before !== undefined ? (
              <>: <span style={{ color: "#389e0d" }}>{p.after ?? p.before}</span></>
            ) : null}
            {p.when && <Typography.Text type="secondary"> · {p.when}</Typography.Text>}
            {p.note && <Typography.Text type="secondary"> ({p.note})</Typography.Text>}
          </div>
        );
      })}
      {max && lines.length > max && <Typography.Text type="secondary">{t("amendLine.more", { count: lines.length - max })}</Typography.Text>}
    </div>
  );
}
