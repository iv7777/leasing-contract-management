import type { ReactNode } from "react";
import { List, Typography } from "antd";
import { yuan } from "./format";

export interface BillRowData {
  key: string | number;
  /** The fee (item) name, bold. */
  name: ReactNode;
  /** A short second part of the title, such as the month. */
  period?: string;
  /** Under the name, small: due date and the like. */
  detail?: ReactNode;
  /** The amount on the right of the first line. */
  amountFen?: number;
  /** The tag (or tags) on the right of the second line. */
  status?: ReactNode;
  onClick?: () => void;
}

/** Bills as compact two-line rows for a phone held upright: name · month and the amount, then the due date and one status tag.
 * Tapping a row opens its details. */
export default function BillRows({ rows, empty }: { rows: BillRowData[]; empty?: string }) {
  return (
    <List
      bordered
      size="small"
      dataSource={rows}
      locale={empty ? { emptyText: empty } : undefined}
      renderItem={(r) => (
        <List.Item onClick={r.onClick} style={{ display: "block", cursor: r.onClick ? "pointer" : undefined }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <Typography.Text strong style={{ minWidth: 0, wordBreak: "break-word" }}>
              {r.name}
              {r.period ? ` · ${r.period}` : ""}
            </Typography.Text>
            {r.amountFen !== undefined && <Typography.Text style={{ whiteSpace: "nowrap" }}>{yuan(r.amountFen)}</Typography.Text>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {r.detail}
            </Typography.Text>
            <div style={{ flexShrink: 0 }}>{r.status}</div>
          </div>
        </List.Item>
      )}
    />
  );
}
