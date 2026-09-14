import { useEffect, useState } from "react";
import { Button, Form, Grid, Input, InputNumber, List, Modal, Select, Space, Table, Tag, Typography, Card } from "antd";
import { PlusOutlined, DownloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { PartyDto } from "@lcm/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ContractDto {
  id: number;
  referenceNumber: string;
  landlordPartyId: number;
  tenantPartyId: number;
  termStart: string;
  termEnd: string;
  status: "draft" | "active" | "expired" | "terminated";
  versionNumber: number;
}

const statusColor: Record<ContractDto["status"], string> = {
  draft: "default",
  active: "green",
  expired: "orange",
  terminated: "red",
};

export default function ContractsPage() {
  const { t, i18n } = useTranslation();
  const exportLang = i18n.language.startsWith("zh") ? "zh" : "en";
  const { user } = useAuth();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [contracts, setContracts] = useState<ContractDto[]>([]);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ contracts: ContractDto[] }>("/contracts").then((r) => setContracts(r.contracts)),
      api.get<{ parties: PartyDto[] }>("/parties").then((r) => setParties(r.parties)),
    ]).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const partyName = (id: number) => parties.find((p) => p.id === id)?.name ?? id;
  const partyLink = (id: number) => (
    <Link to={`/parties?highlight=${id}`} onClick={(e) => e.stopPropagation()}>
      {partyName(id)}
    </Link>
  );

  const onCreate = async () => {
    const values = await form.validateFields();
    const { dueDay, dueMonthOffset, ...contractFields } = values;
    await api.post("/contracts", { ...contractFields, billingRules: { dueDay, dueMonthOffset: dueMonthOffset ?? 0 } });
    setModalOpen(false);
    form.resetFields();
    load();
  };

  const canCreate = user?.role === "admin" || user?.role === "manager";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("contracts.title")}
        </Typography.Title>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={() => window.open(`/api/contracts.csv?lang=${exportLang}`, "_blank")}>
            {t("contracts.exportCsv")}
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              {t("contracts.addContract")}
            </Button>
          )}
        </Space>
      </Space>

      {isMobile ? (
        <List
          loading={loading}
          dataSource={contracts}
          renderItem={(c) => (
            <Card style={{ marginBottom: 12 }} onClick={() => navigate(`/contracts/${c.id}`)}>
              <Typography.Text strong>{c.referenceNumber}</Typography.Text> <Tag color={statusColor[c.status]}>{t(`contracts.${c.status}`)}</Tag>
              <br />
              <Typography.Text type="secondary">
                {partyLink(c.tenantPartyId)} · {c.termStart} → {c.termEnd}
              </Typography.Text>
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={contracts}
          onRow={(c) => ({ onClick: () => navigate(`/contracts/${c.id}`), style: { cursor: "pointer" } })}
          columns={[
            { title: t("contracts.reference"), dataIndex: "referenceNumber" },
            { title: t("contracts.tenant"), dataIndex: "tenantPartyId", render: (id: number) => partyLink(id) },
            { title: t("contracts.termStart"), dataIndex: "termStart" },
            { title: t("contracts.termEnd"), dataIndex: "termEnd" },
            {
              title: t("contracts.status"),
              dataIndex: "status",
              render: (s: ContractDto["status"]) => <Tag color={statusColor[s]}>{t(`contracts.${s}`)}</Tag>,
            },
            { title: t("contracts.version"), dataIndex: "versionNumber" },
          ]}
        />
      )}

      <Modal
        title={t("contracts.addContract")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onCreate}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="referenceNumber" label={t("contracts.reference")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="landlordPartyId" label={t("contracts.landlord")} rules={[{ required: true }]}>
            <Select options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="tenantPartyId" label={t("contracts.tenant")} rules={[{ required: true }]}>
            <Select options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="termStart" label={t("contracts.termStart")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="termEnd" label={t("contracts.termEnd")} rules={[{ required: true }]}>
            <Input placeholder="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="dueDay" label={t("contracts.dueDay")} rules={[{ required: true }]} initialValue={25}>
            <InputNumber min={1} max={31} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dueMonthOffset" label={t("contracts.dueMonthOffset")} initialValue={-1}>
            <InputNumber min={-3} max={3} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
