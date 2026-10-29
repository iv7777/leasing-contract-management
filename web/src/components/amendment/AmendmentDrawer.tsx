import { useEffect, useState } from "react";
import { Alert, Descriptions, Drawer, Spin, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { docDisplayName } from "../billing/format";
import { lineParts, type AmendmentLine } from "./amendmentText";

interface Detail {
  amendment: {
    id: number;
    contractId: number;
    contractRef: string | null;
    type: string;
    status: "draft" | "pending" | "approved" | "rejected" | "withdrawn";
    reason: string;
    effectiveDate: string;
    baseContractVersion: number;
    newVersion: number | null;
    createdAt: string;
    createdBy: string | null;
    submittedAt: string | null;
    submittedBy: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    reviewReason: string | null;
    supportingDocument: { id: number; docType: string; name: string | null; voided: boolean } | null;
  };
  lines: AmendmentLine[];
}

const STATUS_COLOR: Record<string, string> = { draft: "default", pending: "orange", approved: "green", rejected: "red", withdrawn: "default" };

/** Side panel with everything about one amendment: who did what and when, its document, and what it changes (old → new). */
export default function AmendmentDrawer({ amendmentId, onClose }: { amendmentId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (amendmentId === null) return;
    api
      .get<Detail>(`/amendments/${amendmentId}`)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, t)));
  }, [amendmentId, t]);

  const a = data?.amendment;
  const stamp = (who: string | null, at: string | null) => (who || at ? `${who ?? "—"}${at ? ` · ${at.slice(0, 16).replace("T", " ")}` : ""}` : "—");

  let body: React.ReactNode = <Spin />;
  if (error) body = <Alert type="error" showIcon message={error} />;
  else if (a && data) {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Tag>{t(`contracts.amendTypeNames.${a.type}`, { defaultValue: a.type })}</Tag>
          <Tag color={STATUS_COLOR[a.status]}>{t(`contracts.${a.status}`)}</Tag>
        </div>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label={t("audit.fields.contract")}>
            <Link to={`/contracts/${a.contractId}`}>{a.contractRef}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={t("contracts.effectiveDate")}>{a.effectiveDate}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.reason")}>{a.reason}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.supportingDocument")}>{a.supportingDocument ? docDisplayName(t, a.supportingDocument) : "—"}</Descriptions.Item>
          <Descriptions.Item label={t("amendDrawer.drafted")}>{stamp(a.createdBy, a.createdAt)}</Descriptions.Item>
          {a.submittedAt && <Descriptions.Item label={t("amendDrawer.submitted")}>{stamp(a.submittedBy, a.submittedAt)}</Descriptions.Item>}
          {a.reviewedAt && <Descriptions.Item label={t(a.status === "rejected" ? "amendDrawer.rejected" : "amendDrawer.approved")}>{stamp(a.reviewedBy, a.reviewedAt)}</Descriptions.Item>}
          {a.reviewReason && <Descriptions.Item label={t("amendDrawer.reviewComment")}>{a.reviewReason}</Descriptions.Item>}
          <Descriptions.Item label={t("amendDrawer.version")}>
            {a.newVersion ? `v${a.baseContractVersion} → v${a.newVersion}` : t("amendDrawer.basedOn", { version: a.baseContractVersion })}
          </Descriptions.Item>
        </Descriptions>
        <div>
          <Typography.Title level={5}>{t("amendDrawer.changes")}</Typography.Title>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            pagination={false}
            dataSource={data.lines.map((l) => lineParts(t, l))}
            locale={{ emptyText: t("amendDrawer.noChanges") }}
            scroll={{ x: "max-content" }}
            columns={[
              { title: t("amendDrawer.what"), dataIndex: "what" },
              { title: t("amendDrawer.before"), dataIndex: "before", render: (v?: string) => (v ? <span style={{ color: "#cf1322" }}>{v}</span> : "") },
              { title: t("amendDrawer.after"), dataIndex: "after", render: (v?: string) => (v ? <span style={{ color: "#389e0d" }}>{v}</span> : "") },
              { title: t("amendDrawer.when"), dataIndex: "when" },
              { title: t("amendDrawer.note"), dataIndex: "note" },
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <Drawer open={amendmentId !== null} onClose={onClose} width={Math.min(620, typeof window === "undefined" ? 620 : window.innerWidth)} title={a ? `${t("amendDrawer.title")} #${a.id}` : t("amendDrawer.title")} destroyOnClose>
      {body}
    </Drawer>
  );
}
