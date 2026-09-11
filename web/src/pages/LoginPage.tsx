import { useState } from "react";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth, ApiError } from "../auth/AuthContext";

export default function LoginPage() {
  const { t } = useTranslation();
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.email, values.password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? t("login.invalidCredentials") : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f6f7f5",
        padding: 16,
      }}
    >
      <Card style={{ width: 360, maxWidth: "100%" }}>
        <Typography.Title level={3} style={{ marginTop: 0, textAlign: "center" }}>
          {t("app.title")}
        </Typography.Title>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="email" label={t("login.email")} rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="username" size="large" />
          </Form.Item>
          <Form.Item name="password" label={t("login.password")} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            {t("login.submit")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
