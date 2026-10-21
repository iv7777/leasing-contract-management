import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Card, Space, Table, Tag, Typography, message } from "antd";
import { CheckCircleFilled, ExclamationCircleFilled, PlayCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";

interface DocRow {
  id: number;
  ownerType: string;
  ownerId: number;
  owner: string | null;
  name: string | null;
  docType: string;
  voided: boolean;
}
interface FilesResult {
  documentCount: number;
  missing: DocRow[];
  orphans: { relativePath: string; sizeBytes: number }[];
}
interface ChecksumResult {
  checked: number;
  skippedMissing: number;
  mismatched: DocRow[];
}
interface DatabaseResult {
  integrityOk: boolean;
  integrity: string[];
  foreignKeyViolations: { table: string; rowid: number | null; parent: string }[];
  foreignKeyViolationCount: number;
}
interface DiskInfo {
  freeBytes: number;
  totalBytes: number;
}
interface StorageResult {
  lastSuccessfulBackup: { startedAt: string; completedAt: string | null; kind: string } | null;
  latestRunStatus: string | null;
  documents: DiskInfo | null;
  backups: DiskInfo | null;
}

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
};

const ownerLink = (r: DocRow) =>
  r.ownerType === "contract" ? `/contracts/${r.ownerId}` : r.ownerType === "property" ? `/properties/${r.ownerId}` : null;

function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <Space>
      {ok ? <CheckCircleFilled style={{ color: "#52c41a" }} /> : <ExclamationCircleFilled style={{ color: "#faad14" }} />}
      <Typography.Text strong>{children}</Typography.Text>
    </Space>
  );
}

/** One check: a Run button, a verdict line and (when something is wrong) the detail. */
function CheckCard<T>({ title, description, slow, run, render }: { title: string; description: string; slow?: boolean; run: () => Promise<T>; render: (r: T) => ReactNode }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const go = async () => {
    setLoading(true);
    try {
      setResult(await run());
      setRanAt(new Date());
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card
      title={title}
      extra={
        <Button icon={<PlayCircleOutlined />} loading={loading} onClick={() => void go()}>
          {result ? t("health.runAgain") : t("health.run")}
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        {description}
        {slow ? ` ${t("health.slowNote")}` : ""}
      </Typography.Paragraph>
      {result && (
        <>
          {render(result)}
          {ranAt && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary">{t("health.ranAt", { time: ranAt.toLocaleTimeString() })}</Typography.Text>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function SystemHealthPage() {
  const { t } = useTranslation();
  const [storage, setStorage] = useState<StorageResult | null>(null);
  useEffect(() => {
    void api.get<StorageResult>("/system-health/storage").then(setStorage).catch(() => undefined);
  }, []);

  const docColumns = () => [
    { title: "#", dataIndex: "id", width: 60, render: (v: number) => `#${v}` },
    {
      title: t("health.document"),
      render: (_: unknown, r: DocRow) => (
        <Space wrap>
          <span>{r.name?.trim() || r.docType}</span>
          {r.voided && <Tag color="red">{t("contracts.documentVoided")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("health.belongsTo"),
      render: (_: unknown, r: DocRow) => {
        const to = ownerLink(r);
        const label = r.owner ?? `${r.ownerType} #${r.ownerId}`;
        return to ? <Link to={to}>{label}</Link> : label;
      },
    },
  ];

  const ageDays = storage?.lastSuccessfulBackup ? (Date.now() - new Date(storage.lastSuccessfulBackup.startedAt).getTime()) / 86400000 : null;
  const backupStale = ageDays === null || ageDays > 2;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {t("nav.systemHealth")}
      </Typography.Title>
      <Alert type="info" showIcon message={t("health.readOnly")} />

      <CheckCard<FilesResult>
        title={t("health.files.title")}
        description={t("health.files.description")}
        run={() => api.get<FilesResult>("/system-health/files")}
        render={(r) => (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Verdict ok={r.missing.length === 0}>
              {r.missing.length === 0 ? t("health.files.noneMissing", { count: r.documentCount }) : t("health.files.someMissing", { count: r.missing.length })}
            </Verdict>
            {r.missing.length > 0 && (
              <>
                <Typography.Text type="secondary">{t("health.files.fixMissing")}</Typography.Text>
                <Table size="small" rowKey="id" pagination={false} dataSource={r.missing} columns={docColumns()} scroll={{ x: true }} />
              </>
            )}
            <Verdict ok={r.orphans.length === 0}>
              {r.orphans.length === 0 ? t("health.files.noOrphans") : t("health.files.someOrphans", { count: r.orphans.length })}
            </Verdict>
            {r.orphans.length > 0 && (
              <>
                <Typography.Text type="secondary">{t("health.files.orphanNote")}</Typography.Text>
                <Table
                  size="small"
                  rowKey="relativePath"
                  pagination={r.orphans.length > 20 ? { pageSize: 20 } : false}
                  dataSource={r.orphans}
                  scroll={{ x: true }}
                  columns={[
                    { title: t("health.file"), dataIndex: "relativePath" },
                    { title: t("health.size"), dataIndex: "sizeBytes", width: 100, render: (v: number) => formatBytes(v) },
                  ]}
                />
              </>
            )}
          </Space>
        )}
      />

      <CheckCard<ChecksumResult>
        title={t("health.checksums.title")}
        description={t("health.checksums.description")}
        slow
        run={() => api.post<ChecksumResult>("/system-health/checksums")}
        render={(r) => (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Verdict ok={r.mismatched.length === 0}>
              {r.mismatched.length === 0 ? t("health.checksums.allMatch", { count: r.checked }) : t("health.checksums.someMismatch", { count: r.mismatched.length })}
            </Verdict>
            {r.skippedMissing > 0 && <Typography.Text type="secondary">{t("health.checksums.skipped", { count: r.skippedMissing })}</Typography.Text>}
            {r.mismatched.length > 0 && <Table size="small" rowKey="id" pagination={false} dataSource={r.mismatched} columns={docColumns()} scroll={{ x: true }} />}
          </Space>
        )}
      />

      <CheckCard<DatabaseResult>
        title={t("health.database.title")}
        description={t("health.database.description")}
        run={() => api.get<DatabaseResult>("/system-health/database")}
        render={(r) => (
          <Space direction="vertical">
            <Verdict ok={r.integrityOk}>{r.integrityOk ? t("health.database.integrityOk") : t("health.database.integrityBad")}</Verdict>
            {!r.integrityOk && r.integrity.slice(0, 20).map((line, i) => <Typography.Text key={i} type="danger">{line}</Typography.Text>)}
            <Verdict ok={r.foreignKeyViolationCount === 0}>
              {r.foreignKeyViolationCount === 0 ? t("health.database.fkOk") : t("health.database.fkBad", { count: r.foreignKeyViolationCount })}
            </Verdict>
            {r.foreignKeyViolations.slice(0, 20).map((v, i) => (
              <Typography.Text key={i} type="danger">{`${v.table} #${v.rowid ?? "?"} → ${v.parent}`}</Typography.Text>
            ))}
          </Space>
        )}
      />

      <Card title={t("health.storage.title")}>
        {!storage ? null : (
          <Space direction="vertical">
            <Verdict ok={!backupStale}>
              {storage.lastSuccessfulBackup
                ? t("health.storage.lastBackup", { when: new Date(storage.lastSuccessfulBackup.startedAt).toLocaleString(), days: Math.floor(ageDays ?? 0) })
                : t("health.storage.noBackup")}
            </Verdict>
            {storage.latestRunStatus === "failed" && <Typography.Text type="danger">{t("health.storage.latestFailed")}</Typography.Text>}
            {([["documents", storage.documents], ["backups", storage.backups]] as const).map(([key, d]) =>
              d ? (
                <Verdict key={key} ok={d.freeBytes / d.totalBytes > 0.1}>
                  {t(`health.storage.${key}Disk`, { free: formatBytes(d.freeBytes), total: formatBytes(d.totalBytes) })}
                </Verdict>
              ) : null,
            )}
          </Space>
        )}
      </Card>
    </Space>
  );
}
