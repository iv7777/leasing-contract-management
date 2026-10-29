import { useState } from "react";
import { Alert, Form, Input, Modal, message } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";

/** Any signed-in user changes their own password here: current one first, then the new one twice. */
export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    form.resetFields();
    setError(null);
    onClose();
  };

  const save = async () => {
    setError(null);
    let v: { currentPassword: string; newPassword: string };
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/me/password", { currentPassword: v.currentPassword, newPassword: v.newPassword });
      message.success(t("account.passwordChanged"));
      close();
    } catch (err) {
      setError(apiErrorMessage(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("account.changePassword")} open={open} onCancel={close} onOk={() => void save()} okText={t("account.changePasswordOk")} cancelText={t("common.cancel")} confirmLoading={saving} destroyOnClose>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("account.passwordHint")} />
      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={error} />}
      <Form form={form} layout="vertical" autoComplete="off" preserve={false}>
        <Form.Item name="currentPassword" label={t("account.currentPassword")} rules={[{ required: true, message: t("account.currentRequired") }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label={t("account.newPassword")}
          rules={[
            { required: true, message: t("account.newRequired") },
            { min: 10, message: t("users.passwordRule") },
            { pattern: /[A-Za-z]/, message: t("users.passwordRule") },
            { pattern: /\d/, message: t("users.passwordRule") },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t("account.confirmPassword")}
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: t("account.confirmRequired") },
            ({ getFieldValue }) => ({ validator: (_, value) => (!value || getFieldValue("newPassword") === value ? Promise.resolve() : Promise.reject(new Error(t("account.mismatch")))) }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
