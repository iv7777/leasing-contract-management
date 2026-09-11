import { Card, Col, Row, Statistic, Typography } from "antd";
import { HomeOutlined, TeamOutlined, FileProtectOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PropertyDto, PartyDto } from "@lcm/shared";
import { useAuth } from "../auth/AuthContext";

export default function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [propertyCount, setPropertyCount] = useState<number | null>(null);
  const [partyCount, setPartyCount] = useState<number | null>(null);

  useEffect(() => {
    void api.get<{ properties: PropertyDto[] }>("/properties").then((r) => setPropertyCount(r.properties.length));
    void api.get<{ parties: PartyDto[] }>("/parties").then((r) => setPartyCount(r.parties.length));
  }, []);

  return (
    <div>
      <Typography.Title level={4}>{t("nav.dashboard")}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {user?.name} · {t(`users.${user?.role ?? "viewer"}`)}
      </Typography.Paragraph>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title={t("nav.properties")} value={propertyCount ?? undefined} prefix={<HomeOutlined />} loading={propertyCount === null} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title={t("nav.parties")} value={partyCount ?? undefined} prefix={<TeamOutlined />} loading={partyCount === null} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <Statistic title="Phase" value="1 — Foundation" prefix={<FileProtectOutlined />} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
