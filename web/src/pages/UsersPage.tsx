import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography, message } from "antd";
import { EditOutlined, KeyOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PropertyDto, PublicUser, Role } from "@lcm/shared";
import { ROLES } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { HelpIcon } from "../help/HelpIcon";

export default function UsersPage() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [properties, setProperties] = useState<PropertyDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [editForm] = Form.useForm();
  const [passwordUser, setPasswordUser] = useState<PublicUser | null>(null);
  const [passwordForm] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ users: PublicUser[] }>("/users").then((r) => setUsers(r.users)),
      api.get<{ properties: PropertyDto[] }>("/properties").then((r) => setProperties(r.properties)),
    ]).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const onCreate = async () => {
    const values = await createForm.validateFields();
    await api.post("/users", values);
    setCreateOpen(false);
    createForm.resetFields();
    load();
  };

  const onEdit = async () => {
    if (!editingUser) return;
    const values = await editForm.validateFields();
    try {
      await api.patch(`/users/${editingUser.id}`, values);
      message.success(t("common.save"));
      setEditingUser(null);
      load();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
      else throw err;
    }
  };

  const onSetPassword = async () => {
    if (!passwordUser) return;
    const values = await passwordForm.validateFields();
    try {
      await api.post(`/users/${passwordUser.id}/set-password`, values);
      message.success(t("users.resetPassword"));
      setPasswordUser(null);
      passwordForm.resetFields();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
      else throw err;
    }
  };

  const toggleActive = async (u: PublicUser) => {
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      message.success(u.active ? "User deactivated" : "User activated");
      load();
    } catch (err) {
      if (err instanceof ApiError) message.error(err.message);
      else throw err;
    }
  };

  const onDelete = (u: PublicUser) => {
    Modal.confirm({
      title: t("users.deleteUser"),
      content: t("users.deleteUserConfirm"),
      okText: t("common.confirm"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await api.delete(`/users/${u.id}`);
          message.success(t("users.deleteUser"));
          load();
        } catch (err) {
          if (err instanceof ApiError) message.error(err.message);
          else throw err;
        }
      },
    });
  };

  const openEdit = (u: PublicUser) => {
    setEditingUser(u);
    editForm.setFieldsValue({
      name: u.name,
      email: u.email,
      role: u.role,
      propertyIds: u.propertyIds,
      canDownloadPdf: u.canDownloadPdf,
      canPrint: u.canPrint,
    });
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("users.title")}
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
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
            render: (ids: number[], u) => (
              <div style={{ minWidth: 200, wordBreak: "break-word" }}>
                {u.role === "admin" ? "—" : ids.map((id) => properties.find((p) => p.id === id)?.name ?? id).join(", ")}
              </div>
            ),
          },
          {
            title: t("common.active"),
            dataIndex: "active",
            render: (active: boolean, u) => {
              const isSelf = u.id === currentUser?.id;
              const toggle = <Switch checked={active} disabled={isSelf} onChange={() => toggleActive(u)} />;
              return isSelf ? <Tooltip title={t("users.cannotDeactivateSelf")}>{toggle}</Tooltip> : toggle;
            },
          },
          {
            title: t("common.actions"),
            key: "actions",
            render: (_: unknown, u) => (
              <Space>
                <Tooltip title={t("users.editUser")}>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(u)} />
                </Tooltip>
                <Tooltip title={t("users.resetPassword")}>
                  <Button size="small" icon={<KeyOutlined />} onClick={() => setPasswordUser(u)} />
                </Tooltip>
                {u.id !== currentUser?.id && (
                  <Tooltip title={t("users.deleteUser")}>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(u)} />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={t("users.addUser")}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreate}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={createForm} layout="vertical">
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
          <Form.Item
            name="propertyIds"
            label={
              <>
                {t("users.assignedProperties")} <HelpIcon field="assignedProperties" />
              </>
            }
          >
            <Select
              mode="multiple"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              placeholder={t("users.assignedProperties")}
            />
          </Form.Item>
          <Form.Item
            name="canDownloadPdf"
            label={
              <>
                {t("users.canDownloadPdf")} <HelpIcon field="userPermissions" />
              </>
            }
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="canPrint" label={t("users.canPrint")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("users.editUser")}
        open={!!editingUser}
        onCancel={() => setEditingUser(null)}
        onOk={onEdit}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label={t("common.name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t("users.email")} rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="role"
            label={t("users.role")}
            rules={[{ required: true }]}
            tooltip={editingUser?.id === currentUser?.id ? t("users.cannotChangeOwnRole") : undefined}
          >
            <Select
              disabled={editingUser?.id === currentUser?.id}
              options={ROLES.map((r) => ({ value: r, label: t(`users.${r}`) }))}
            />
          </Form.Item>
          <Form.Item
            name="propertyIds"
            label={
              <>
                {t("users.assignedProperties")} <HelpIcon field="assignedProperties" />
              </>
            }
          >
            <Select
              mode="multiple"
              options={properties.map((p) => ({ value: p.id, label: p.name }))}
              placeholder={t("users.assignedProperties")}
            />
          </Form.Item>
          <Form.Item
            name="canDownloadPdf"
            label={
              <>
                {t("users.canDownloadPdf")} <HelpIcon field="userPermissions" />
              </>
            }
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="canPrint" label={t("users.canPrint")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("users.resetPassword")}
        open={!!passwordUser}
        onCancel={() => {
          setPasswordUser(null);
          passwordForm.resetFields();
        }}
        onOk={onSetPassword}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item name="password" label={t("users.newPassword")} rules={[{ required: true, min: 8 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
