import { useEffect, useState } from "react";
import { Button, Space, Table, Tag, Typography, message } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";

interface RunDto {
  id: number;
  trigger: "scheduled" | "manual";
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "partial" | "failed";
  contractsProcessed: number;
  chargesCreated: number;
  contractsFailed: number;
  missingReadings: number;
  detailsJson: string | null;
  error: string | null;
}
interface Details {
  failures?: { contractId: number; referenceNumber: string; error: string }[];
  missingReadings?: { contractId: number; referenceNumber: string; stream: string; period: string }[];
}

const statusColor: Record<RunDto["status"], string> = { running: "blue", succeeded: "green", partial: "orange", failed: "red" };

export default function BillingRunsPage() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    void api
      .get<{ runs: RunDto[] }>("/billing/runs")
      .then((r) => setRuns(r.runs))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const onRunNow = async () => {
    setRunning(true);
    try {
      const r = await api.post<{ chargesCreated: number; contractsProcessed: number }>("/billing/run");
      message.success(t("billing.runs.runDone", { charges: r.chargesCreated, contracts: r.contractsProcessed }));
      load();
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("billing.runs.title")}
        </Typography.Title>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={onRunNow}>
          {t("billing.runs.runNow")}
        </Button>
      </Space>
      <Typography.Paragraph type="secondary">{t("billing.runs.note")}</Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={runs}
        size="small"
        scroll={{ x: 800 }}
        columns={[
          { title: t("backups.id"), dataIndex: "id", width: 70 },
          { title: t("billing.runs.trigger"), dataIndex: "trigger", render: (v: RunDto["trigger"]) => <Tag>{t(`billing.runs.${v}`)}</Tag> },
          { title: t("backups.startedAt"), dataIndex: "startedAt" },
          { title: t("backups.status"), dataIndex: "status", render: (s: RunDto["status"]) => <Tag color={statusColor[s]}>{t(`billing.runs.status.${s}`)}</Tag> },
          { title: t("billing.runs.contracts"), dataIndex: "contractsProcessed" },
          { title: t("billing.runs.created"), dataIndex: "chargesCreated" },
          { title: t("billing.runs.failed"), dataIndex: "contractsFailed", render: (v: number) => (v > 0 ? <Typography.Text type="danger">{v}</Typography.Text> : 0) },
          { title: t("billing.runs.missing"), dataIndex: "missingReadings" },
        ]}
        expandable={{
          rowExpandable: (r: RunDto) => !!r.detailsJson || !!r.error,
          expandedRowRender: (r: RunDto) => {
            const d: Details = r.detailsJson ? JSON.parse(r.detailsJson) : {};
            return (
              <>
                {r.error && <Typography.Paragraph type="danger">{r.error}</Typography.Paragraph>}
                {(d.failures ?? []).map((f) => (
                  <Typography.Paragraph key={f.contractId} type="danger" style={{ marginBottom: 4 }}>
                    {f.referenceNumber}: {f.error}
                  </Typography.Paragraph>
                ))}
                {(d.missingReadings ?? []).length > 0 && (
                  <Typography.Paragraph style={{ marginBottom: 0 }}>
                    {t("billing.runs.missing")}: {(d.missingReadings ?? []).map((m) => `${m.referenceNumber} ${m.stream} ${m.period}`).join("; ")}
                  </Typography.Paragraph>
                )}
              </>
            );
          },
        }}
      />
    </div>
  );
}
