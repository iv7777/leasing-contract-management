import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { PlusOutlined, UploadOutlined, DownloadOutlined, DeleteOutlined, LockOutlined, EditOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PropertyDto, UnitDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useHelpTopic } from "../help/HelpContext";
import { HelpIcon } from "../help/HelpIcon";

interface DocumentDto {
  id: number;
  docType: string;
  classification: "ordinary" | "sensitive";
  mimeType: string;
  uploadedAt: string;
}

export default function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [property, setProperty] = useState<PropertyDto | null>(null);
  const [units, setUnits] = useState<UnitDto[]>([]);
  const [unitContracts, setUnitContracts] = useState<
    Record<number, { contractId: number; referenceNumber: string; status: string }[]>
  >({});
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [unitForm] = Form.useForm();
  const [docForm] = Form.useForm();
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [editPropertyModal, setEditPropertyModal] = useState(false);
  const [editPropertyForm] = Form.useForm();
  const [editingUnit, setEditingUnit] = useState<UnitDto | null>(null);
  const [editUnitForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState("units");
  useHelpTopic(`properties.detail.${activeTab}`);

  const load = () => {
    void api
      .get<{
        property: PropertyDto;
        units: UnitDto[];
        unitContracts: Record<number, { contractId: number; referenceNumber: string; status: string }[]>;
      }>(`/properties/${id}`)
      .then((r) => {
        setProperty(r.property);
        setUnits(r.units);
        setUnitContracts(r.unitContracts ?? {});
      });
    void api
      .get<{ documents: DocumentDto[] }>(`/documents?ownerType=property&ownerId=${id}`)
      .then((r) => setDocuments(r.documents));
  };

  useEffect(load, [id]);

  const displayName = property && (i18n.language.startsWith("zh") || !property.nameEn ? property.name : property.nameEn);

  const onCreateUnit = async () => {
    const values = await unitForm.validateFields();
    await api.post(`/properties/${id}/units`, values);
    setUnitModalOpen(false);
    unitForm.resetFields();
    load();
  };

  const onEditProperty = async () => {
    try {
      const values = await editPropertyForm.validateFields();
      await api.patch(`/properties/${id}`, values);
      setEditPropertyModal(false);
      message.success(t("common.save"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const toggleArchived = async () => {
    if (!property) return;
    try {
      await api.patch(`/properties/${id}`, { archived: !property.archived });
      message.success(property.archived ? t("common.unarchived") : t("common.archived"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const onEditUnit = async () => {
    if (!editingUnit) return;
    try {
      const values = await editUnitForm.validateFields();
      await api.patch(`/properties/${id}/units/${editingUnit.id}`, values);
      setEditingUnit(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const toggleUnitRetired = async (u: UnitDto) => {
    try {
      await api.patch(`/properties/${id}/units/${u.id}`, { availability: u.availability === "unavailable" ? "vacant" : "unavailable" });
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  const onUploadDocument = async () => {
    if (!pendingFile || uploadingDoc) return;
    setUploadingDoc(true);
    try {
      const values = await docForm.validateFields();
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("ownerType", "property");
      formData.append("ownerId", id!);
      formData.append("docType", values.docType);
      formData.append("classification", values.classification);
      await api.post("/documents", formData);
      setDocModalOpen(false);
      docForm.resetFields();
      setPendingFile(null);
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    } finally {
      setUploadingDoc(false);
    }
  };

  const download = async (docId: number) => {
    const res = await fetch(`/api/documents/${docId}/download`, { credentials: "include" });
    if (!res.ok) {
      message.error(t("common.error"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const deleteDocument = async (docId: number) => {
    try {
      await api.delete(`/documents/${docId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : t("common.error"));
    }
  };

  if (!property) return <Typography.Text>{t("common.loading")}</Typography.Text>;

  const canEdit = user?.role === "admin" || user?.role === "manager";
  const isAdmin = user?.role === "admin";

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <div>
          <Typography.Title level={4} style={{ marginBottom: 0 }}>
            {displayName} {property.archived && <Tag>{t("common.archived")}</Tag>}
          </Typography.Title>
          <Typography.Paragraph type="secondary">{property.address}</Typography.Paragraph>
        </div>
        {isAdmin && (
          <Space>
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editPropertyForm.setFieldsValue(property);
                setEditPropertyModal(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button onClick={toggleArchived}>{property.archived ? t("common.unarchive") : t("common.archive")}</Button>
          </Space>
        )}
      </Space>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "units",
            label: t("properties.units"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setUnitModalOpen(true)} style={{ marginBottom: 12 }}>
                    {t("properties.addUnit")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={units}
                  renderItem={(u) => (
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Button
                                key="edit"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editUnitForm.setFieldsValue(u);
                                  setEditingUnit(u);
                                }}
                              />,
                              <Button key="retire" size="small" onClick={() => toggleUnitRetired(u)}>
                                {u.availability === "unavailable" ? t("common.unarchive") : t("common.archive")}
                              </Button>,
                            ]
                          : []
                      }
                    >
                      <Space direction="vertical" size={0}>
                        <Typography.Text strong>{u.unitLabel}</Typography.Text>
                        <Typography.Text type="secondary">
                          {t(`properties.${u.unitType === "building" ? "building" : "openLand"}`)} · {u.rentableAreaSqm} sqm ·{" "}
                          {t(`properties.${u.availability}`)}
                        </Typography.Text>
                        <Space size={4} wrap>
                          <Typography.Text type="secondary">{t("common.relatedContracts")}:</Typography.Text>
                          {(unitContracts[u.id] ?? []).length === 0 ? (
                            <Typography.Text type="secondary">{t("common.noneYet")}</Typography.Text>
                          ) : (
                            (unitContracts[u.id] ?? []).map((c) => (
                              <Link key={c.contractId} to={`/contracts/${c.contractId}`}>
                                <Tag color={c.status === "active" ? "green" : undefined}>{c.referenceNumber}</Tag>
                              </Link>
                            ))
                          )}
                        </Space>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: "documents",
            label: t("properties.documents"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<UploadOutlined />} onClick={() => setDocModalOpen(true)} style={{ marginBottom: 12 }}>
                    {t("properties.uploadDocument")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={documents}
                  renderItem={(d) => (
                    <List.Item
                      actions={[
                        <Button key="dl" type="link" icon={<DownloadOutlined />} onClick={() => download(d.id)}>
                          {t("properties.download")}
                        </Button>,
                        ...(isAdmin
                          ? [
                              <Popconfirm
                                key="del"
                                title={t("properties.confirmDeleteDocument")}
                                onConfirm={() => deleteDocument(d.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button type="link" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []),
                      ]}
                    >
                      <Space>
                        {d.classification === "sensitive" && <LockOutlined />}
                        <Typography.Text>{d.docType}</Typography.Text>
                        {d.classification === "sensitive" && <Tag color="orange">{t("properties.sensitive")}</Tag>}
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={t("properties.addUnit")}
        open={unitModalOpen}
        onCancel={() => setUnitModalOpen(false)}
        onOk={onCreateUnit}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form form={unitForm} layout="vertical">
          <Form.Item name="unitLabel" label={t("properties.unitLabel")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="unitType" label={t("properties.unitType")} rules={[{ required: true }]} initialValue="building">
            <Select
              options={[
                { value: "building", label: t("properties.building") },
                { value: "open_land", label: t("properties.openLand") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="rentableAreaSqm"
            label={t("properties.rentableArea")}
            rules={[{ required: true, pattern: /^\d+(\.\d+)?$/, message: "Enter a decimal number" }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("properties.uploadDocument")}
        open={docModalOpen}
        onCancel={() => setDocModalOpen(false)}
        onOk={onUploadDocument}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        confirmLoading={uploadingDoc}
        okButtonProps={{ disabled: !pendingFile || uploadingDoc }}
        cancelButtonProps={{ disabled: uploadingDoc }}
        closable={!uploadingDoc}
        maskClosable={!uploadingDoc}
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label="File" required>
            <Upload
              disabled={uploadingDoc}
              beforeUpload={(file) => {
                setPendingFile(file);
                return false;
              }}
              maxCount={1}
              accept="image/*,.pdf"
              capture="environment"
            >
              <Button icon={<UploadOutlined />}>Select file</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="docType" label={t("properties.docType")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="classification"
            label={
              <>
                {t("properties.classification")} <HelpIcon field="documentClassification" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="ordinary"
          >
            <Select
              options={[
                { value: "ordinary", label: t("properties.ordinary") },
                { value: "sensitive", label: t("properties.sensitive") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={editPropertyModal}
        onCancel={() => setEditPropertyModal(false)}
        onOk={onEditProperty}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editPropertyForm} layout="vertical">
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

      <Modal
        title={t("common.edit")}
        open={!!editingUnit}
        onCancel={() => setEditingUnit(null)}
        onOk={onEditUnit}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editUnitForm} layout="vertical">
          <Form.Item name="unitLabel" label={t("properties.unitLabel")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="unitType" label={t("properties.unitType")} rules={[{ required: true }]}>
            <Select
              options={[
                { value: "building", label: t("properties.building") },
                { value: "open_land", label: t("properties.openLand") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="rentableAreaSqm"
            label={t("properties.rentableArea")}
            rules={[{ required: true, pattern: /^\d+(\.\d+)?$/, message: "Enter a decimal number" }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
