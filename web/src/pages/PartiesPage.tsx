import { useEffect, useState } from "react";
import { Button, Form, Grid, Input, List, Modal, Select, Space, Table, Tag, Typography, Card } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PartyDto } from "@lcm/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { useBreakpoint } = Grid;

export default function PartiesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [parties, setParties] = useState<PartyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    void api
      .get<{ parties: PartyDto[] }>("/parties")
      .then((r) => setParties(r.parties))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const displayName = (p: PartyDto) => (i18n.language.startsWith("zh") || !p.nameEn ? p.name : p.nameEn);

  const onCreate = async () => {
    const values = await form.validateFields();
    await api.post("/parties", values);
    setModalOpen(false);
    form.resetFields();
    load();
  };

  const canCreate = user?.role === "admin" || user?.role === "manager";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("parties.title")}
        </Typography.Title>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            {t("parties.addParty")}
          </Button>
        )}
      </Space>

      {isMobile ? (
        <List
          loading={loading}
          dataSource={parties}
          renderItem={(p) => (
            <Card style={{ marginBottom: 12 }}>
              <Typography.Text strong>{displayName(p)}</Typography.Text> <Tag>{t(`parties.${p.type}`)}</Tag>
              <br />
              <Typography.Text type="secondary">{p.contactDetails}</Typography.Text>
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={parties}
          columns={[
            { title: t("common.name"), dataIndex: "name", render: (_, p) => displayName(p) },
            { title: t("parties.type"), dataIndex: "type", render: (v: string) => t(`parties.${v}`) },
            { title: t("parties.contactDetails"), dataIndex: "contactDetails" },
          ]}
        />
      )}

      <Modal
        title={t("parties.addParty")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onCreate}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label={t("parties.type")} rules={[{ required: true }]} initialValue="company">
            <Select
              options={[
                { value: "company", label: t("parties.company") },
                { value: "individual", label: t("parties.individual") },
              ]}
            />
          </Form.Item>
          <Form.Item name="name" label={t("common.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nameEn" label={t("common.nameEn")}>
            <Input />
          </Form.Item>
          <Form.Item name="contactDetails" label={t("parties.contactDetails")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
