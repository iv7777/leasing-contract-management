import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Button,
  Card,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { PlusOutlined, UploadOutlined, DownloadOutlined, LockOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { PropertyDto, UnitDto } from "@lcm/shared";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [unitModalOpen, setUnitModalOpen] = useState(false);
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [unitForm] = Form.useForm();
  const [docForm] = Form.useForm();
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = () => {
    void api
      .get<{ property: PropertyDto; units: UnitDto[] }>(`/properties/${id}`)
      .then((r) => {
        setProperty(r.property);
        setUnits(r.units);
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

  const onUploadDocument = async () => {
    if (!pendingFile) return;
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

  if (!property) return <Typography.Text>{t("common.loading")}</Typography.Text>;

  const canEdit = user?.role === "admin" || user?.role === "manager";

  return (
    <div>
      <Typography.Title level={4}>{displayName}</Typography.Title>
      <Typography.Paragraph type="secondary">{property.address}</Typography.Paragraph>

      <Tabs
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
                    <List.Item>
                      <Space direction="vertical" size={0}>
                        <Typography.Text strong>{u.unitLabel}</Typography.Text>
                        <Typography.Text type="secondary">
                          {t(`properties.${u.unitType === "building" ? "building" : "openLand"}`)} · {u.rentableAreaSqm} sqm ·{" "}
                          {t(`properties.${u.availability}`)}
                        </Typography.Text>
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
        okButtonProps={{ disabled: !pendingFile }}
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label="File" required>
            <Upload
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
            label={t("properties.classification")}
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
    </div>
  );
}
