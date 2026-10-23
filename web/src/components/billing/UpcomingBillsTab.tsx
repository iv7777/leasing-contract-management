import { useEffect, useState } from "react";
import { Alert, Space, Statistic, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { streamName, yuan } from "./format";
import ChargeDetailDrawer from "./ChargeDetailDrawer";

interface UpcomingDto {
  asOf: string;
  cutoff: string;
  status: string;
  billingFrequency: string;
  autoBilling: boolean;
  items: { pricingStreamId: number; feeType: string; streamLabel: string; serviceStart: string; serviceEnd: string; dueDate: string; amountFen: number }[];
  totalFen: number;
  missingReadings: { feeType: string; streamLabel: string; month: string; dueDate: string }[];
}

/** What this contract will be billed next: the bills the system has not
 * created yet but will, through the end of next month. A forecast — a bill
 * only exists once it falls due. */
export default function UpcomingBillsTab({ contractId, reloadKey }: { contractId: number; reloadKey: unknown }) {
  const { t } = useTranslation();
  const [data, setData] = useState<UpcomingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ contractId: number; pricingStreamId: number; serviceStart: string; serviceEnd: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    void api
      .get<UpcomingDto>(`/contracts/${contractId}/billing/upcoming`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [contractId, reloadKey]);

  if (!data) return null;

  if (data.status !== "active") return <Alert type="info" showIcon message={t("billing.upcoming.notActive")} />;
  if (data.billingFrequency !== "monthly") return <Alert type="info" showIcon message={t("billing.upcoming.notMonthly")} />;

  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("billing.upcoming.intro", { cutoff: data.cutoff })}
      </Typography.Paragraph>
      {!data.autoBilling && <Alert type="warning" showIcon message={t("billing.upcoming.autoOff")} />}
      {data.missingReadings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={t("billing.overview.readingsTitle", { count: data.missingReadings.length })}
          description={data.missingReadings.map((m) => `${streamName(t, m.streamLabel, m.feeType)} ${m.month}`).join(" · ")}
        />
      )}
      <Statistic title={t("billing.upcoming.total")} value={yuan(data.totalFen)} />
      <Table
        rowKey={(r) => `${r.feeType}-${r.serviceStart}-${r.streamLabel}`}
        size="small"
        loading={loading}
        pagination={false}
        dataSource={data.items}
        onRow={(r) => ({ onClick: () => setPreview({ contractId, pricingStreamId: r.pricingStreamId, serviceStart: r.serviceStart, serviceEnd: r.serviceEnd }), style: { cursor: "pointer" } })}
        locale={{ emptyText: t("billing.upcoming.empty") }}
        columns={[
          { title: t("billing.upcoming.dueDate"), dataIndex: "dueDate", width: 120 },
          { title: t("billing.upcoming.fee"), render: (_: unknown, r: UpcomingDto["items"][number]) => streamName(t, r.streamLabel, r.feeType) },
          { title: t("billing.upcoming.service"), render: (_: unknown, r: UpcomingDto["items"][number]) => `${r.serviceStart} → ${r.serviceEnd}` },
          { title: t("billing.upcoming.amount"), dataIndex: "amountFen", align: "right" as const, render: (v: number) => yuan(v) },
        ]}
      />
      <Typography.Text type="secondary">{t("billing.upcoming.forecastNote")}</Typography.Text>
      <ChargeDetailDrawer chargeId={null} projected={preview} onClose={() => setPreview(null)} />
    </Space>
  );
}
