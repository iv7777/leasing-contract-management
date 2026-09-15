import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Dropdown, Form, Grid, Input, List, Modal, Select, Space, Switch, Table, Tag, Typography, Card, message, Popconfirm } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, MoreOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const { useBreakpoint } = Grid;

interface ContractSummaryDto {
  id: number;
  referenceNumber: string;
  landlordPartyId: number;
  tenantPartyId: number;
  status: "draft" | "active" | "expired" | "terminated";
}

export default function PartiesPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const screens = useBreakpoint();
  const isMobile = !screens.md;
  const [searchParams] = useSearchParams();
  const highlightId = Number(searchParams.get("highlight")) || null;

  const [parties, setParties] = useState<PartyDto[]>([]);
  const [contracts, setContracts] = useState<ContractSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editingParty, setEditingParty] = useState<PartyDto | null>(null);
  const [editForm] = Form.useForm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ parties: PartyDto[] }>("/parties").then((r) => setParties(r.parties)),
      api.get<{ contracts: ContractSummaryDto[] }>("/contracts").then((r) => setContracts(r.contracts)),
    ]).finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!highlightId || loading) return;
    const el = document.querySelector(`[data-row-key="${highlightId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, loading]);

  const relatedContracts = (partyId: number) =>
    contracts.filter((c) => c.landlordPartyId === partyId || c.tenantPartyId === partyId);

  const relatedContractsList = (partyId: number) => {
    const related = relatedContracts(partyId);
    if (related.length === 0) return <Typography.Text type="secondary">{t("common.noneYet")}</Typography.Text>;
    return (
      <Space size={4} wrap>
        {related.map((c) => (
          <Link key={c.id} to={`/contracts/${c.id}`} onClick={(e) => e.stopPropagation()}>
            <Tag
              color={c.status === "active" ? "green" : undefined}
              style={{ width: 110, whiteSpace: "normal", wordBreak: "break-all", textAlign: "center" }}
            >
              {c.referenceNumber}
            </Tag>
          </Link>
        ))}
      </Space>
    );
  };

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

  const onDelete = async (p: PartyDto) => {
    try {
      await api.delete(`/parties/${p.id}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const confirmDelete = (p: PartyDto) => {
    Modal.confirm({
      title: t("parties.confirmDelete"),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: () => onDelete(p),
    });
  };

  const canCreate = user?.role === "admin" || user?.role === "manager";
  const isAdmin = user?.role === "admin";

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
            <Card
              data-row-key={p.id}
              className={p.id === highlightId ? "row-highlight" : undefined}
              style={{ marginBottom: 12 }}
            >
              <Space style={{ width: "100%", justifyContent: "space-between" }}>
                <div>
                  <Typography.Text strong>{displayName(p)}</Typography.Text> <Tag>{t(`parties.${p.type}`)}</Tag>
                  {p.archived && <Tag>{t("common.archived")}</Tag>}
                  <br />
                  <Typography.Text type="secondary">{p.contactDetails}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary">{t("common.relatedContracts")}: </Typography.Text>
                  {relatedContractsList(p.id)}
                </div>
                <Space>
                  {canCreate && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />}
                  {isAdmin && (
                    <Popconfirm
                      title={t("parties.confirmDelete")}
                      onConfirm={() => onDelete(p)}
                      okText={t("common.delete")}
                      cancelText={t("common.cancel")}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
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
          dataSource={visibleParties}
          rowClassName={(p) => (p.id === highlightId ? "row-highlight" : "")}
          columns={[
            {
              title: t("common.name"),
              dataIndex: "name",
              ellipsis: false,
              width: 90,
              render: (_, p) => <div style={{ width: 90, wordBreak: "break-all" }}>{displayName(p)}</div>,
            },
            { title: t("parties.type"), dataIndex: "type", render: (v: string) => t(`parties.${v}`) },
            {
              title: t("parties.contactDetails"),
              dataIndex: "contactDetails",
              width: 90,
              render: (v: string) => <div style={{ width: 90, wordBreak: "break-all" }}>{v}</div>,
            },
            {
              title: t("common.relatedContracts"),
              key: "relatedContracts",
              width: 120,
              render: (_: unknown, p: PartyDto) => relatedContractsList(p.id),
            },
            {
              title: t("common.archived"),
              dataIndex: "archived",
              render: (archived: boolean) => (archived ? <Tag>{t("common.archived")}</Tag> : null),
            },
            {
              title: t("common.actions"),
              key: "actions",
              render: (_: unknown, p: PartyDto) =>
                (canCreate || isAdmin) && (
                  <Space size={4}>
                    {canCreate && <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)} />}
                    {(canCreate || isAdmin) && (
                      <Dropdown
                        menu={{
                          items: [
                            canCreate && {
                              key: "archive",
                              label: p.archived ? t("common.unarchive") : t("common.archive"),
                              onClick: () => toggleArchived(p),
                            },
                            isAdmin && {
                              key: "delete",
                              label: t("common.delete"),
                              danger: true,
                              icon: <DeleteOutlined />,
                              onClick: () => confirmDelete(p),
                            },
                          ].filter((item) => !!item),
                        }}
                      >
                        <Button size="small" icon={<MoreOutlined />} />
                      </Dropdown>
                    )}
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
