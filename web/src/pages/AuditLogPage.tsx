import { useEffect, useState } from "react";
import { Button, Input, Select, Space, Table, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";

interface AuditEventDto {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  reason: string | null;
  details: unknown;
  createdAt: string;
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  const [events, setEvents] = useState<AuditEventDto[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const [entityType, setEntityType] = useState<string | undefined>(undefined);
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (entityType) params.set("entityType", entityType);
    if (entityId) params.set("entityId", entityId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    void api
      .get<{ events: AuditEventDto[]; total: number }>(`/audit?${params.toString()}`)
      .then((r) => {
        setEvents(r.events);
        setTotal(r.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [page]);
  useEffect(() => {
    void api.get<{ entityTypes: string[] }>("/audit/entity-types").then((r) => setEntityTypes(r.entityTypes));
  }, []);

  const applyFilters = () => {
    setPage(1);
    load();
  };

  return (
    <div>
      <Typography.Title level={4}>{t("audit.title")}</Typography.Title>

      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder={t("audit.entityType")}
          style={{ width: 180 }}
          value={entityType}
          onChange={setEntityType}
          options={entityTypes.map((e) => ({ value: e, label: e }))}
        />
        <Input placeholder={t("audit.entityId")} style={{ width: 120 }} value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        <Input placeholder={`${t("audit.from")} (YYYY-MM-DD)`} style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input placeholder={`${t("audit.to")} (YYYY-MM-DD)`} style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <Button type="primary" onClick={applyFilters}>
          {t("audit.applyFilters")}
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={events}
        scroll={{ x: true }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: setPage,
          showSizeChanger: false,
        }}
        expandable={{
          rowExpandable: (e) => !!e.details || !!e.reason,
          expandedRowRender: (e) => (
            <div>
              {e.reason && (
                <Typography.Paragraph>
                  <strong>{t("contracts.reason")}:</strong> {e.reason}
                </Typography.Paragraph>
              )}
              {!!e.details && <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(e.details, null, 2)}</pre>}
            </div>
          ),
        }}
        columns={[
          { title: t("audit.timestamp"), dataIndex: "createdAt", width: 200 },
          { title: t("audit.actor"), dataIndex: "actorName", render: (v: string | null) => v ?? t("audit.system") },
          { title: t("audit.action"), dataIndex: "action", render: (v: string) => <Tag>{v}</Tag> },
          { title: t("audit.entityType"), dataIndex: "entityType" },
          { title: t("audit.entityId"), dataIndex: "entityId" },
        ]}
      />
    </div>
  );
}
