import { Button, Card, Col, Form, Input, Modal, Row, Statistic, Typography, message } from "antd";
import { HomeOutlined, TeamOutlined, BellOutlined, EditOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { PropertyDto, PartyDto } from "@lcm/shared";
import { useAuth } from "../auth/AuthContext";

interface SystemInfo {
  version: string;
  buildDate: string;
  buildNumber: number | null;
  copyright: string;
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [propertyCount, setPropertyCount] = useState<number | null>(null);
  const [partyCount, setPartyCount] = useState<number | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const loadSystemInfo = () => {
    void api.get<SystemInfo>("/system-info").then(setSystemInfo);
  };

  useEffect(() => {
    void api.get<{ properties: PropertyDto[] }>("/properties").then((r) => setPropertyCount(r.properties.length));
    void api.get<{ parties: PartyDto[] }>("/parties").then((r) => setPartyCount(r.parties.length));
    void api.get<{ reminders: unknown[] }>("/reminders").then((r) => setReminderCount(r.reminders.length));
    loadSystemInfo();
  }, []);

  const onSaveCopyright = async () => {
    const values = await form.validateFields();
    const updated = await api.patch<SystemInfo>("/system-info", values);
    setSystemInfo(updated);
    setEditOpen(false);
    message.success(t("common.save"));
  };

  return (
    <div>
      <Typography.Title level={4}>{t("nav.dashboard")}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {user?.name} · {t(`users.${user?.role ?? "viewer"}`)}
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card hoverable onClick={() => navigate("/properties")}>
            <Statistic title={t("nav.properties")} value={propertyCount ?? undefined} prefix={<HomeOutlined />} loading={propertyCount === null} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card hoverable onClick={() => navigate("/parties")}>
            <Statistic title={t("nav.parties")} value={partyCount ?? undefined} prefix={<TeamOutlined />} loading={partyCount === null} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card hoverable onClick={() => navigate("/reminders")}>
            <Statistic title={t("dashboard.openReminders")} value={reminderCount ?? undefined} prefix={<BellOutlined />} loading={reminderCount === null} />
          </Card>
        </Col>
      </Row>

      {systemInfo && (
        <Typography.Paragraph type="secondary" style={{ marginTop: 24, textAlign: "center" }}>
          {t("dashboard.version")} {systemInfo.version} ({t("dashboard.buildNumber")} {systemInfo.buildNumber ?? "?"}) ·{" "}
          {t("dashboard.built")} {new Date(systemInfo.buildDate).toLocaleDateString(i18n.language)} · {systemInfo.copyright}
          {user?.role === "admin" && (
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                form.setFieldsValue({ copyright: systemInfo.copyright });
                setEditOpen(true);
              }}
            />
          )}
        </Typography.Paragraph>
      )}

      <Modal
        title={t("dashboard.editCopyright")}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={onSaveCopyright}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="copyright" label={t("dashboard.copyrightText")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
