import { useEffect, useState } from "react";
import { Alert, Button, Space, Table, Tag, Typography, message } from "antd";
import { CloudDownloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";

interface BackupRunDto {
  id: number;
  kind: "daily" | "weekly";
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "failed";
  backupReference: string | null;
  includedDocumentCount: number | null;
  error: string | null;
}

const kindColor: Record<BackupRunDto["kind"], string> = {
  daily: "default",
  weekly: "purple",
};

const statusColor: Record<BackupRunDto["status"], string> = {
  running: "blue",
  succeeded: "green",
  failed: "red",
};

export default function BackupsPage() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<BackupRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = () => {
    setLoading(true);
    void api
      .get<{ runs: BackupRunDto[] }>("/backups")
      .then((r) => setRuns(r.runs))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onRunNow = async () => {
    setRunning(true);
    message.info(t("backups.runStarted"));
    try {
      await api.post("/backups/run");
      message.success(t("backups.runSucceeded"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setRunning(false);
    }
  };

  const download = (id: number) => {
    window.open(`/api/backups/${id}/download`, "_blank");
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("backups.title")}
        </Typography.Title>
        <Button type="primary" icon={<ThunderboltOutlined />} loading={running} onClick={onRunNow}>
          {t("backups.runNow")}
        </Button>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("backups.retentionNote")}
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={runs}
        style={{ marginBottom: 24 }}
        columns={[
          { title: t("backups.id"), dataIndex: "id", width: 70 },
          {
            title: t("backups.kind"),
            dataIndex: "kind",
            render: (k: BackupRunDto["kind"]) => <Tag color={kindColor[k]}>{t(`backups.kinds.${k}`)}</Tag>,
          },
          { title: t("backups.startedAt"), dataIndex: "startedAt" },
          { title: t("backups.completedAt"), dataIndex: "completedAt", render: (v: string | null) => v ?? "—" },
          {
            title: t("backups.status"),
            dataIndex: "status",
            render: (s: BackupRunDto["status"]) => <Tag color={statusColor[s]}>{t(`backups.${s}`)}</Tag>,
          },
          { title: t("backups.documentCount"), dataIndex: "includedDocumentCount", render: (v: number | null) => v ?? "—" },
          {
            title: t("backups.error"),
            dataIndex: "error",
            render: (v: string | null) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : null),
          },
          {
            title: t("common.actions"),
            key: "actions",
            render: (_: unknown, r: BackupRunDto) =>
              r.status === "succeeded" && r.backupReference ? (
                <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => download(r.id)}>
                  {t("backups.download")}
                </Button>
              ) : (
                <Typography.Text type="secondary">{t("backups.noSnapshot")}</Typography.Text>
              ),
          },
        ]}
      />

      <Alert
        type="info"
        showIcon
        message={t("backups.restoreTitle")}
        description={
          <>
            <Typography.Paragraph style={{ marginBottom: 8 }}>{t("backups.restoreBody")}</Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <Typography.Text code>{t("backups.restoreCommand")}</Typography.Text>
            </Typography.Paragraph>
            <Typography.Paragraph style={{ marginBottom: 0 }} type="secondary">
              {t("backups.restoreNote")}
            </Typography.Paragraph>
          </>
        }
      />
    </div>
  );
}
