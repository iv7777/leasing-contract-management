import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PropertyDto, PublicUser, Role } from "@lcm/shared";
import { ROLES } from "@lcm/shared";
import { api } from "../api/client";

export default function UsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ users: PublicUser[] }>("/users").then((r) => setUsers(r.users)),
      api.get<{ properties: PropertyDto[] }>("/properties").then((r) => setProperties(r.properties)),
    ]).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onCreate = async () => {
    const values = await form.validateFields();
    await api.post("/users", values);
    setModalOpen(false);
    form.resetFields();
    load();
  };

  const toggleActive = async (u: PublicUser) => {
    await api.patch(`/users/${u.id}`, { active: !u.active });
    message.success(u.active ? "User deactivated" : "User activated");
    load();
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("users.title")}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          {t("users.addUser")}
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={users}
        scroll={{ x: true }}
        columns={[
          { title: t("common.name"), dataIndex: "name" },
          { title: t("users.email"), dataIndex: "email" },
          {
            title: t("users.role"),
            dataIndex: "role",
            render: (r: Role) => <Tag>{t(`users.${r}`)}</Tag>,
          },
          {
            title: t("users.assignedProperties"),
            dataIndex: "propertyIds",
            render: (ids: number[], u) =>
              u.role === "admin"
                ? "—"
                : ids.map((id) => properties.find((p) => p.id === id)?.name ?? id).join(", "),
          },
          {
            title: t("common.active"),
            dataIndex: "active",
            render: (active: boolean, u) => <Switch checked={active} onChange={() => toggleActive(u)} />,
          },
        ]}
      />

      <Modal
        title={t("users.addUser")}
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
          <Form.Item name="email" label={t("users.email")} rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label={t("users.password")} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="role" label={t("users.role")} rules={[{ required: true }]} initialValue="viewer">
            <Select options={ROLES.map((r) => ({ value: r, label: t(`users.${r}`) }))} />
          </Form.Item>
          <Form.Item name="propertyIds" label={t("users.assignedProperties")}>
            <Select
              mode="multiple"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              placeholder={t("users.assignedProperties")}
            />
          </Form.Item>
          <Form.Item name="canDownloadPdf" label={t("users.canDownloadPdf")} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="canPrint" label={t("users.canPrint")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
