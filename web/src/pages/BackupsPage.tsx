import { useEffect, useState } from "react";
import { Alert, Button, Card, Grid, Input, List, Modal, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import { CloudDownloadOutlined, EditOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";

const { useBreakpoint } = Grid;

interface BackupRunDto {
  id: number;
  kind: "daily" | "weekly";
  startedAt: string;
  completedAt: string | null;
  status: "running" | "succeeded" | "failed";
  backupReference: string | null;
  includedDocumentCount: number | null;
  error: string | null;
  comment: string | null;
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
  const { t, i18n } = useTranslation();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [runs, setRuns] = useState<BackupRunDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState<BackupRunDto | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
      message.error(apiErrorMessage(err, t));
    } finally {
      setRunning(false);
    }
  };

  const openComment = (r: BackupRunDto) => {
    setEditing(r);
    setDraft(r.comment ?? "");
  };

  const saveComment = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await api.patch<{ id: number; comment: string | null }>(`/backups/${editing.id}/comment`, { comment: draft.trim() || null });
      setRuns((rs) => rs.map((r) => (r.id === res.id ? { ...r, comment: res.comment } : r)));
      setEditing(null);
      message.success(t("backups.commentSaved"));
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  const commentButton = (r: BackupRunDto) => (
    <Tooltip title={r.comment ? t("backups.editComment") : t("backups.addComment")}>
      <Button size="small" icon={<EditOutlined />} onClick={() => openComment(r)} />
    </Tooltip>
  );

  const commentLine = (r: BackupRunDto) => (
    <Typography.Text type="secondary" style={{ whiteSpace: "pre-wrap" }}>
      {r.comment}
    </Typography.Text>
  );

  const download = (id: number) => {
    window.open(`/api/backups/${id}/download`, "_blank");
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "—";
    const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
    return new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
  };

  const downloadButton = (r: BackupRunDto) =>
    r.status === "succeeded" && r.backupReference ? (
      <Tooltip title={t("backups.download")}>
        <Button size="small" icon={<CloudDownloadOutlined />} onClick={() => download(r.id)} />
      </Tooltip>
    ) : (
      <Typography.Text type="secondary">{t("backups.noSnapshot")}</Typography.Text>
    );

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

      {isMobile ? (
        <List
          loading={loading}
          dataSource={runs}
          style={{ marginBottom: 24 }}
          renderItem={(r) => (
            <Card style={{ marginBottom: 12 }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }} align="start">
                <div>
                  <Typography.Text strong>#{r.id}</Typography.Text> <Tag color={kindColor[r.kind]}>{t(`backups.kinds.${r.kind}`)}</Tag>{" "}
                  <Tag color={statusColor[r.status]}>{t(`backups.${r.status}`)}</Tag>
                  <br />
                  <Typography.Text type="secondary">
                    {t("backups.startedAt")}: {formatDateTime(r.startedAt)}
                  </Typography.Text>
                  <br />
                  <Typography.Text type="secondary">
                    {t("backups.completedAt")}: {formatDateTime(r.completedAt)}
                  </Typography.Text>
                  <br />
                  <Typography.Text type="secondary">
                    {t("backups.documentCount")}: {r.includedDocumentCount ?? "—"}
                  </Typography.Text>
                  {r.error && (
                    <>
                      <br />
                      <Typography.Text type="danger">{r.error}</Typography.Text>
                    </>
                  )}
                  {r.comment && (
                    <>
                      <br />
                      {commentLine(r)}
                    </>
                  )}
                </div>
                <Space>
                  {commentButton(r)}
                  {downloadButton(r)}
                </Space>
              </Space>
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={runs}
          style={{ marginBottom: 24 }}
          expandable={{
            // A run's comment sits on a second line under the row; rows without one stay single-line.
            expandedRowKeys: runs.filter((r) => r.comment).map((r) => r.id),
            rowExpandable: (r) => !!r.comment,
            expandedRowRender: (r) => commentLine(r),
            expandIcon: () => null,
            columnWidth: 0,
          }}
          columns={[
            { title: t("backups.id"), dataIndex: "id", width: 60 },
            {
              title: t("backups.kind"),
              dataIndex: "kind",
              width: 90,
              render: (k: BackupRunDto["kind"]) => <Tag color={kindColor[k]}>{t(`backups.kinds.${k}`)}</Tag>,
            },
            { title: t("backups.startedAt"), dataIndex: "startedAt", width: 150, render: (v: string) => formatDateTime(v) },
            { title: t("backups.completedAt"), dataIndex: "completedAt", width: 150, render: (v: string | null) => formatDateTime(v) },
            {
              title: t("backups.status"),
              dataIndex: "status",
              width: 90,
              render: (s: BackupRunDto["status"]) => <Tag color={statusColor[s]}>{t(`backups.${s}`)}</Tag>,
            },
            { title: t("backups.documentCount"), dataIndex: "includedDocumentCount", width: 90, render: (v: number | null) => v ?? "—" },
            {
              title: t("backups.error"),
              dataIndex: "error",
              render: (v: string | null) => (v ? <div style={{ minWidth: 90, wordBreak: "break-all" }}><Typography.Text type="danger">{v}</Typography.Text></div> : null),
            },
            {
              title: t("common.actions"),
              key: "actions",
              width: 110,
              render: (_: unknown, r: BackupRunDto) => (
                <Space>
                  {commentButton(r)}
                  {downloadButton(r)}
                </Space>
              ),
            },
          ]}
        />
      )}

      <Modal
        open={!!editing}
        title={editing ? t("backups.commentTitle", { id: editing.id }) : ""}
        okText={t("common.save")}
        confirmLoading={saving}
        onOk={saveComment}
        onCancel={() => setEditing(null)}
        destroyOnClose
      >
        <Input.TextArea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} autoSize={{ minRows: 3, maxRows: 8 }} placeholder={t("backups.commentPlaceholder")} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {t("backups.commentHint")}
        </Typography.Paragraph>
      </Modal>

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
