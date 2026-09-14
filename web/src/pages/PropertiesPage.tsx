import { useEffect, useState } from "react";
import { Button, Card, Form, Grid, Input, List, Modal, Space, Switch, Table, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import type { PropertyDto } from "@lcm/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { useBreakpoint } = Grid;

export default function PropertiesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    void api
      .get<{ properties: PropertyDto[] }>("/properties")
      .then((r) => setProperties(r.properties))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const displayName = (p: PropertyDto) => (i18n.language.startsWith("zh") || !p.nameEn ? p.name : p.nameEn);
  const visibleProperties = showArchived ? properties : properties.filter((p) => !p.archived);

  const onCreate = async () => {
    const values = await form.validateFields();
    await api.post("/properties", values);
    setModalOpen(false);
    form.resetFields();
    load();
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("properties.title")}
        </Typography.Title>
        <Space>
          <Space size={4}>
            <Switch size="small" checked={showArchived} onChange={setShowArchived} />
            <Typography.Text type="secondary">{t("common.showArchived")}</Typography.Text>
          </Space>
          {user?.role === "admin" && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              {t("properties.addProperty")}
            </Button>
          )}
        </Space>
      </Space>

      {isMobile ? (
        <List
          loading={loading}
          dataSource={visibleProperties}
          renderItem={(p) => (
            <Card style={{ marginBottom: 12 }} onClick={() => navigate(`/properties/${p.id}`)}>
              <Typography.Text strong>{displayName(p)}</Typography.Text>
              <br />
              <Typography.Text type="secondary">{p.address}</Typography.Text>
              {p.archived && (
                <>
                  <br />
                  <Tag>{t("common.archived")}</Tag>
                </>
              )}
            </Card>
          )}
        />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={visibleProperties}
          onRow={(p) => ({ onClick: () => navigate(`/properties/${p.id}`), style: { cursor: "pointer" } })}
          columns={[
            { title: t("common.name"), dataIndex: "name", render: (_, p) => displayName(p) },
            { title: t("common.address"), dataIndex: "address" },
            {
              title: t("common.archived"),
              dataIndex: "archived",
              width: 120,
              render: (archived: boolean) => (archived ? <Tag>{t("common.archived")}</Tag> : null),
            },
          ]}
        />
      )}

      <Modal
        title={t("properties.addProperty")}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onCreate}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t("common.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nameEn" label={t("common.nameEn")}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label={t("common.address")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
