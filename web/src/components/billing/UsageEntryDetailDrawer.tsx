import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Descriptions, Drawer, Space, Spin, Table, Tag, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { periodLabel, streamName, yuan } from "./format";
import { MeterPhotoCell } from "./MeterPhoto";
import { esc, printHtml } from "./print";

interface Detail {
  entry: {
    id: number;
    contractId: number;
    contractRef: string | null;
    tenantName: string | null;
    units: string[];
    contractStatus: string | null;
    feeType: string | null;
    itemName: string | null;
    serviceStart: string;
    serviceEnd: string;
    quantity: string;
    unit: string;
    amountFen: number | null;
    source: string | null;
    enteredBy: string | null;
    createdAt: string;
    calculationMethod: string | null;
    unitPrice: string | null;
    photoDocumentId: number | null;
    photoMissing: boolean;
  };
  bills: { chargeId: number; feeType: string; itemName: string; dueDate: string; amountFen: number; balanceFen: number; isOverdue: boolean; daysOverdue: number }[];
}

/** Side panel with everything about one meter reading: the price used, who entered it and when, the photo, and the bills made from it. */
export default function UsageEntryDetailDrawer({
  entryId,
  onClose,
  onOpenCharge,
}: {
  entryId: number | null;
  onClose: () => void;
  /** Open one of the bills made from the reading. */
  onOpenCharge?: (chargeId: number) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (entryId === null) return;
    api
      .get<Detail>(`/usage-entries/${entryId}`)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, t)));
  }, [entryId, t]);

  const e = data?.entry;
  const item = e && e.itemName && e.feeType ? streamName(t, e.itemName, e.feeType) : "";
  const price = e && e.calculationMethod === "metered" && e.unitPrice ? t("usageDetail.pricePerUnit", { price: `¥${Number(e.unitPrice)}`, unit: e.unit }) : e && e.calculationMethod === "metered_amount" ? t("usageDetail.amountWithReading") : null;

  const billTag = (b: Detail["bills"][number]) => {
    if (b.balanceFen === 0) return <Tag color="green">{t("chargeDetail.paid")}</Tag>;
    if (b.isOverdue) return <Tag color="red">{t("contracts.overdueDays", { days: b.daysOverdue })}</Tag>;
    return <Tag color="orange">{t("chargeDetail.unpaid")}</Tag>;
  };

  const print = () => {
    if (!data || !e) return;
    const bills = data.bills
      .map((b) => `<tr><td>${esc(streamName(t, b.itemName, b.feeType))}</td><td>${esc(b.dueDate)}</td><td class="r">${esc(yuan(b.amountFen))}</td><td class="r">${esc(yuan(b.balanceFen))}</td></tr>`)
      .join("");
    printHtml(
      [e.tenantName, e.contractRef, item].filter(Boolean).join(" · "),
      `<h1>${esc([e.tenantName, e.contractRef, item, periodLabel(e.serviceStart, e.serviceEnd)].filter(Boolean).join(" · "))}</h1>
<table>${e.tenantName ? `<tr><th>${esc(t("statement.tenant"))}</th><td>${esc(e.tenantName)}</td><th>${esc(t("statement.units"))}</th><td>${esc(e.units.join(", "))}</td></tr>` : ""}
<tr><th>${esc(t("contracts.usageEntryQuantity"))}</th><td>${esc(`${Number(e.quantity)} ${e.unit}`)}</td><th>${esc(t("usageDetail.price"))}</th><td>${esc(price ?? "")}</td></tr>
${e.amountFen != null ? `<tr><th>${esc(t("contracts.amount"))}</th><td class="r">${esc(yuan(e.amountFen))}</td><th>${esc(t("usageDetail.enteredOn"))}</th><td>${esc(e.createdAt.slice(0, 10))}</td></tr>` : `<tr><th>${esc(t("usageDetail.enteredOn"))}</th><td colspan="3">${esc(e.createdAt.slice(0, 10))}</td></tr>`}
${e.source ? `<tr><th>${esc(t("usageDetail.source"))}</th><td colspan="3">${esc(e.source)}</td></tr>` : ""}</table>
${bills ? `<h2>${esc(t("usageDetail.bills"))}</h2><table>${bills}</table>` : ""}`,
    );
  };

  let body: ReactNode = <Spin />;
  if (error) body = <Alert type="error" showIcon message={error} />;
  else if (data && e) {
    body = (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label={t("audit.fields.contract")}>
            <Link to={`/contracts/${e.contractId}`}>{e.contractRef}</Link>
          </Descriptions.Item>
          {e.tenantName && <Descriptions.Item label={t("statement.tenant")}>{e.tenantName}</Descriptions.Item>}
          {e.units.length > 0 && <Descriptions.Item label={t("statement.units")}>{e.units.join(", ")}</Descriptions.Item>}
          <Descriptions.Item label={t("contracts.fee")}>{item}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.serviceStart")}>{e.serviceStart}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.serviceEnd")}>{e.serviceEnd}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.usageEntryQuantity")}>
            <Typography.Text strong>
              {Number(e.quantity)} {e.unit}
            </Typography.Text>
          </Descriptions.Item>
          {price && <Descriptions.Item label={t("usageDetail.price")}>{price}</Descriptions.Item>}
          {e.amountFen != null && <Descriptions.Item label={t("contracts.amount")}>{yuan(e.amountFen)}</Descriptions.Item>}
          {e.source && <Descriptions.Item label={t("usageDetail.source")}>{e.source}</Descriptions.Item>}
          {e.enteredBy && <Descriptions.Item label={t("usageDetail.enteredBy")}>{e.enteredBy}</Descriptions.Item>}
          <Descriptions.Item label={t("usageDetail.enteredOn")}>{e.createdAt.slice(0, 10)}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.photo")}>
            {e.photoDocumentId ? (
              <MeterPhotoCell entryId={e.id} documentId={e.photoDocumentId} missing={e.photoMissing} canEdit={false} onChanged={() => undefined} />
            ) : (
              <Typography.Text type="secondary">{t("usageDetail.noPhoto")}</Typography.Text>
            )}
          </Descriptions.Item>
        </Descriptions>

        <div>
          <Typography.Title level={5}>{t("usageDetail.bills")}</Typography.Title>
          {data.bills.length === 0 ? (
            <Typography.Text type="secondary">{t("usageDetail.noBills")}</Typography.Text>
          ) : (
            <Table
              size="small"
              rowKey="chargeId"
              pagination={false}
              dataSource={data.bills}
              scroll={{ x: true }}
              onRow={(b) => (onOpenCharge ? { onClick: () => onOpenCharge(b.chargeId), style: { cursor: "pointer" } } : {})}
              columns={[
                { title: t("contracts.fee"), render: (_: unknown, b: Detail["bills"][number]) => streamName(t, b.itemName, b.feeType) },
                { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                { title: t("contracts.amount"), dataIndex: "amountFen", align: "right" as const, render: (v: number) => yuan(v) },
                { title: "", key: "state", render: (_: unknown, b: Detail["bills"][number]) => billTag(b) },
              ]}
            />
          )}
        </div>
      </Space>
    );
  }

  return (
    <Drawer
      open={entryId !== null}
      onClose={onClose}
      width={Math.min(580, typeof window === "undefined" ? 580 : window.innerWidth)}
      title={e ? `${item} · ${periodLabel(e.serviceStart, e.serviceEnd)}` : t("usageDetail.title")}
      extra={
        <Button icon={<PrinterOutlined />} onClick={print} disabled={!data}>
          {t("chargeDetail.print")}
        </Button>
      }
      destroyOnClose
    >
      {body}
    </Drawer>
  );
}
