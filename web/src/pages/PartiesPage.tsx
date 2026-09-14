import { useEffect, useState } from "react";
import { Button, Form, Grid, Input, List, Modal, Select, Space, Switch, Table, Tag, Typography, Card, message } from "antd";
import { PlusOutlined, EditOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { useBreakpoint } = Grid;

export default function PartiesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [parties, setParties] = useState<PartyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingParty, setEditingParty] = useState<PartyDto | null>(null);
  const [editForm] = Form.useForm();

  const load = () => {
    setLoading(true);
    void api
      .get<{ parties: PartyDto[] }>("/parties")
      .then((r) => setParties(r.parties))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const displayName = (p: PartyDto) => (i18n.language.startsWith("zh") || !p.nameEn ? p.name : p.nameEn);
  const visibleParties = showArchived ? parties : parties.filter((p) => !p.archived);

  const onCreate = async () => {
    const values = await form.validateFields();
    await api.post("/parties", values);
    setModalOpen(false);
    form.resetFields();
    load();
  };

  const openEdit = (p: PartyDto) => {
    setEditingParty(p);
    editForm.setFieldsValue(p);
  };

  const onEdit = async () => {
    if (!editingParty) return;
    try {
      const values = await editForm.validateFields();
      await api.patch(`/parties/${editingParty.id}`, values);
      setEditingParty(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const toggleArchived = async (p: PartyDto) => {
    try {
      await api.patch(`/parties/${p.id}`, { archived: !p.archived });
      message.success(p.archived ? t("common.unarchived") : t("common.archived"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const canCreate = user?.role === "admin" || user?.role === "manager";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("parties.title")}
        </Typography.Title>
        <Space>
          <Space size={4}>
            <Switch size="small" checked={showArchived} onChange={setShowArchived} />
            <Typography.Text type="secondary">{t("common.showArchived")}</Typography.Text>
          </Space>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              {t("parties.addParty")}
            </Button>
          )}
        </Space>
      </Space>

      {isMobile ? (
        <List
          loading={loading}
          dataSource={visibleParties}
          renderItem={(p) => (
            <Card style={{ marginBottom: 12 }}>
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <div>
                  <Typography.Text strong>{displayName(p)}</Typography.Text> <Tag>{t(`parties.${p.type}`)}</Tag>
                  {p.archived && <Tag>{t("common.archived")}</Tag>}
                  <br />
                  <Typography.Text type="secondary">{p.contactDetails}</Typography.Text>
                </div>
                {canCreate && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />}
              </Space>
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleParties}
          columns={[
            { title: t("common.name"), dataIndex: "name", render: (_, p) => displayName(p) },
            { title: t("parties.type"), dataIndex: "type", render: (v: string) => t(`parties.${v}`) },
            { title: t("parties.contactDetails"), dataIndex: "contactDetails" },
            {
              title: t("common.archived"),
              dataIndex: "archived",
              width: 100,
              render: (archived: boolean) => (archived ? <Tag>{t("common.archived")}</Tag> : null),
            },
            {
              title: t("common.actions"),
              key: "actions",
              width: 140,
              render: (_: unknown, p: PartyDto) =>
                canCreate && (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />
                    <Button size="small" onClick={() => toggleArchived(p)}>
                      {p.archived ? t("common.unarchive") : t("common.archive")}
                    </Button>
                  </Space>
                ),
            },
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

      <Modal
        title={t("parties.editParty")}
        open={!!editingParty}
        onCancel={() => setEditingParty(null)}
        onOk={onEdit}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="type" label={t("parties.type")} rules={[{ required: true }]}>
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
