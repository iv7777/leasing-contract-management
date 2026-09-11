import { useEffect, useState } from "react";
import { Card, Col, Row, Statistic, Typography, Input, Space } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";

interface OccupancySummary {
  totalAreaSqm: string;
  leasedAreaSqm: string;
  occupancyPercent: string;
  unitCount: number;
  leasedUnitCount: number;
  availableUnitCount: number;
}
interface OccupancyReport {
  asOfDate: string;
  building: OccupancySummary;
  openLand: OccupancySummary;
}

function CategoryCard({ title, summary }: { title: string; summary: OccupancySummary }) {
  const { t } = useTranslation();
  return (
    <Card title={title}>
      <Row gutter={16}>
        <Col span={12}>
          <Statistic title={t("occupancy.occupancyPercent")} value={summary.occupancyPercent} suffix="%" />
        </Col>
        <Col span={12}>
          <Statistic title={t("occupancy.leasedArea")} value={`${summary.leasedAreaSqm} / ${summary.totalAreaSqm}`} />
        </Col>
      </Row>
      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Statistic title={t("occupancy.leased")} value={summary.leasedUnitCount} />
        </Col>
        <Col span={12}>
          <Statistic title={t("occupancy.available")} value={summary.availableUnitCount} />
        </Col>
      </Row>
    </Card>
  );
}

export default function OccupancyPage() {
  const { t } = useTranslation();
  const [date, setDate] = useState("");
  const [report, setReport] = useState<OccupancyReport | null>(null);

  const load = () => {
    void api.get<{ report: OccupancyReport }>(`/reports/occupancy${date ? `?date=${date}` : ""}`).then((r) => setReport(r.report));
  };

  useEffect(load, [date]);

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t("occupancy.title")}
        </Typography.Title>
        <Input placeholder="YYYY-MM-DD" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
      </Space>
      {report && (
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <CategoryCard title={t("occupancy.building")} summary={report.building} />
          </Col>
          <Col xs={24} md={12}>
            <CategoryCard title={t("occupancy.openLand")} summary={report.openLand} />
          </Col>
        </Row>
      )}
    </div>
  );
}
