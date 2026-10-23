import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Descriptions, Drawer, Space, Spin, Table, Tag, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import type { TFunction } from "i18next";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { camel, paymentMethodLabel, periodLabel, streamName, yuan } from "./format";
import { MeterPhotoCell } from "./MeterPhoto";

interface Subperiod {
  start: string;
  end: string;
  calculationMethod: string;
  rateBasis: string;
  baseRate: string;
  effectiveRate: string;
  areaSqm: string | null;
  daysInSubperiod: number;
  daysInMonth: number;
  monthlyEquivalent: string;
  proratedAmount: string;
  concessionDiscountPercentage: string | null;
  concessionReason: string | null;
  amountAfterConcession: string;
  quantity?: string;
  unit?: string | null;
}
interface Detail {
  charge: {
    id: number;
    contractId: number;
    contractRef: string | null;
    contractStatus: string | null;
    feeType: string;
    itemName: string;
    serviceStart: string;
    serviceEnd: string;
    dueDate: string;
    amountFen: number;
    status: "posted" | "voided";
    createdAt: string;
    voidedAt: string | null;
    voidedBy: string | null;
    voidReason: string | null;
    broughtForward: boolean;
  };
  snapshot: { subperiods?: Subperiod[]; totalBeforeRounding?: string } | null;
  balance: { balanceFen: number; allocatedFen: number; adjustedFen: number; isOverdue: boolean; daysOverdue: number; latePenaltyFen: number };
  payments: { id: number; receiptId: number; amountFen: number; reversal: boolean; receivedDate: string | null; paymentMethod: string | null }[];
  adjustments: { id: number; amountFen: number; reason: string; createdAt: string; by: string | null }[];
  reading: { id: number; quantity: string; unit: string; amountFen: number | null; itemName: string | null; photoDocumentId: number | null; photoMissing: boolean } | null;
}

/** "10008.8000" -> "10008.8". */
const num = (v: string | undefined) => (v === undefined ? "?" : String(Number(v)));
const money = (v: string) => `¥${Number(v).toFixed(2)}`;

/** One line of words for how a part of the period was priced. */
function rateLine(t: TFunction, s: Subperiod): string {
  const basis = t(`contracts.${camel(s.rateBasis)}`);
  switch (s.calculationMethod) {
    case "per_sqm":
      return t("chargeDetail.perSqm", { area: s.areaSqm ?? "?", rate: money(s.effectiveRate) });
    case "percentage_escalation":
      return t("chargeDetail.escalated", { base: money(s.baseRate), rate: money(s.effectiveRate), basis });
    case "metered":
      return t("chargeDetail.metered", { quantity: num(s.quantity), unit: s.unit ?? "", price: money(s.effectiveRate) });
    case "metered_amount":
      return t("chargeDetail.meteredAmount", { quantity: num(s.quantity), unit: s.unit ?? "", price: Number(s.effectiveRate).toFixed(4) });
    case "usage_fee_per_unit":
      return t("chargeDetail.feePerUnit", { quantity: num(s.quantity), unit: s.unit ?? "", price: money(s.baseRate) });
    case "usage_fee_percent":
      return t("chargeDetail.feePercent", { pct: s.baseRate });
    default:
      return `${money(s.baseRate)} ${basis}`;
  }
}

function printHtml(title: string, body: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:14px/1.5 sans-serif;margin:24px;color:#222}h1{font-size:18px}h2{font-size:15px;margin-top:18px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:4px 8px;text-align:left}td.r{text-align:right}</style>${body}`);
  doc.close();
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => frame.remove(), 2000);
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Side panel with everything about one bill: how it was worked out, what was paid on it, the reading behind it. */
export default function ChargeDetailDrawer({
  chargeId,
  onClose,
  onVoid,
}: {
  chargeId: number | null;
  onClose: () => void;
  /** Offered to Admins on a bill that can still be voided. */
  onVoid?: (chargeId: number) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (chargeId === null) return;
    api
      .get<Detail>(`/charges/${chargeId}`)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, t)));
  }, [chargeId, t]);

  const c = data?.charge;
  const item = c ? streamName(t, c.itemName, c.feeType) : "";
  const netPaid = data ? data.payments.reduce((s, p) => s + p.amountFen, 0) : 0;
  const canVoid = !!(onVoid && c && c.status === "posted" && netPaid === 0 && (data?.adjustments.length ?? 0) === 0);

  const statusTag = () => {
    if (!data || !c) return null;
    if (c.status === "voided") return <Tag>{t("billing.void.voided")}</Tag>;
    if (data.balance.balanceFen === 0) return <Tag color="green">{t("chargeDetail.paid")}</Tag>;
    if (data.balance.isOverdue) return <Tag color="red">{t("contracts.overdueDays", { days: data.balance.daysOverdue })}</Tag>;
    return <Tag color="orange">{data.balance.allocatedFen > 0 ? t("chargeDetail.partPaid") : t("chargeDetail.unpaid")}</Tag>;
  };

  const print = () => {
    if (!data || !c) return;
    const rows = (data.snapshot?.subperiods ?? []).map((s) => `<tr><td>${esc(`${s.start} → ${s.end}`)}</td><td>${esc(rateLine(t, s))}</td><td class="r">${esc(money(s.amountAfterConcession))}</td></tr>`).join("");
    const pays = data.payments.map((p) => `<tr><td>${esc(p.receivedDate ?? "")}</td><td>${esc(p.paymentMethod ? paymentMethodLabel(t, p.paymentMethod) : "")}</td><td class="r">${esc(yuan(p.amountFen))}</td></tr>`).join("");
    printHtml(
      `${c.contractRef ?? ""} ${item}`,
      `<h1>${esc(`${c.contractRef ?? ""} · ${item} · ${periodLabel(c.serviceStart, c.serviceEnd)}`)}</h1>
<table><tr><th>${esc(t("contracts.dueDate"))}</th><td>${esc(c.dueDate)}</td><th>${esc(t("contracts.amount"))}</th><td class="r">${esc(yuan(c.amountFen))}</td></tr>
<tr><th>${esc(t("chargeDetail.paidSoFar"))}</th><td class="r">${esc(yuan(netPaid))}</td><th>${esc(t("contracts.balance"))}</th><td class="r">${esc(yuan(data.balance.balanceFen))}</td></tr></table>
${rows ? `<h2>${esc(t("chargeDetail.how"))}</h2><table>${rows}</table>` : ""}
${data.reading ? `<p>${esc(t("chargeDetail.reading"))}: ${esc(`${data.reading.quantity} ${data.reading.unit}${data.reading.amountFen != null ? ` · ${yuan(data.reading.amountFen)}` : ""}`)}</p>` : ""}
${pays ? `<h2>${esc(t("chargeDetail.payments"))}</h2><table>${pays}</table>` : ""}`,
    );
  };

  let body: ReactNode = <Spin />;
  if (error) body = <Alert type="error" showIcon message={error} />;
  else if (data && c) {
    body = (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>
          {statusTag()}
          {c.broughtForward && <Tag color="blue">{t("openingBalance.broughtForward")}</Tag>}
        </Space>
        {c.status === "voided" && (
          <Alert type="warning" showIcon message={t("chargeDetail.voidedBy", { who: c.voidedBy ?? "—", when: (c.voidedAt ?? "").slice(0, 10) })} description={c.voidReason ?? undefined} />
        )}
        {c.broughtForward && <Alert type="info" showIcon message={t("chargeDetail.broughtForwardNote", { date: c.serviceStart })} />}
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label={t("audit.fields.contract")}>
            <Link to={`/contracts/${c.contractId}`}>{c.contractRef}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={t("contracts.fee")}>{item}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.serviceStart")}>{c.serviceStart}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.serviceEnd")}>{c.serviceEnd}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.dueDate")}>{c.dueDate}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.amount")}>
            <Typography.Text strong>{yuan(c.amountFen)}</Typography.Text>
          </Descriptions.Item>
          {c.status === "posted" && (
            <>
              <Descriptions.Item label={t("chargeDetail.paidSoFar")}>{yuan(netPaid)}</Descriptions.Item>
              {data.balance.adjustedFen !== 0 && <Descriptions.Item label={t("contracts.adjustments")}>{yuan(data.balance.adjustedFen)}</Descriptions.Item>}
              <Descriptions.Item label={t("contracts.balance")}>
                <Typography.Text strong type={data.balance.balanceFen > 0 ? "danger" : undefined}>
                  {yuan(data.balance.balanceFen)}
                </Typography.Text>
              </Descriptions.Item>
              {data.balance.latePenaltyFen > 0 && <Descriptions.Item label={t("chargeDetail.lateFee")}>{yuan(data.balance.latePenaltyFen)}</Descriptions.Item>}
            </>
          )}
          <Descriptions.Item label={t("chargeDetail.created")}>{c.createdAt.slice(0, 10)}</Descriptions.Item>
        </Descriptions>

        {!c.broughtForward && data.snapshot?.subperiods && data.snapshot.subperiods.length > 0 && (
          <div>
            <Typography.Title level={5}>{t("chargeDetail.how")}</Typography.Title>
            <Table
              size="small"
              rowKey={(s: Subperiod) => `${s.start}-${s.end}-${s.calculationMethod}`}
              pagination={false}
              dataSource={data.snapshot.subperiods}
              scroll={{ x: true }}
              columns={[
                { title: t("chargeDetail.part"), render: (_: unknown, s: Subperiod) => (s.start === s.end ? s.start : `${s.start.slice(5)} → ${s.end.slice(5)}`) },
                {
                  title: t("chargeDetail.calculation"),
                  render: (_: unknown, s: Subperiod) => (
                    <div>
                      <div>
                        {t(`contracts.${camel(s.calculationMethod)}`)}: {rateLine(t, s)}
                      </div>
                      {s.daysInSubperiod !== s.daysInMonth && s.calculationMethod !== "metered" && s.calculationMethod !== "metered_amount" && (
                        <div>{t("chargeDetail.prorated", { days: s.daysInSubperiod, month: s.daysInMonth, monthly: money(s.monthlyEquivalent), part: money(s.proratedAmount) })}</div>
                      )}
                      {s.concessionDiscountPercentage && (
                        <div>
                          {t("chargeDetail.discount", { pct: s.concessionDiscountPercentage })}
                          {s.concessionReason ? ` (${s.concessionReason})` : ""}
                        </div>
                      )}
                    </div>
                  ),
                },
                { title: t("contracts.amount"), align: "right" as const, render: (_: unknown, s: Subperiod) => money(s.amountAfterConcession) },
              ]}
            />
            {data.snapshot.totalBeforeRounding && (
              <Typography.Text type="secondary">
                {t("chargeDetail.rounding", { before: money(data.snapshot.totalBeforeRounding), billed: yuan(c.amountFen) })}
              </Typography.Text>
            )}
          </div>
        )}

        {data.reading && (
          <Descriptions bordered size="small" column={1} title={t("chargeDetail.reading")}>
            <Descriptions.Item label={data.reading.itemName ?? c.itemName}>
              {data.reading.quantity} {data.reading.unit}
              {data.reading.amountFen != null ? ` · ${yuan(data.reading.amountFen)}` : ""}
            </Descriptions.Item>
            {data.reading.photoDocumentId && (
              <Descriptions.Item label={t("contracts.photo")}>
                <MeterPhotoCell entryId={data.reading.id} documentId={data.reading.photoDocumentId} missing={data.reading.photoMissing} canEdit={false} onChanged={() => undefined} />
              </Descriptions.Item>
            )}
          </Descriptions>
        )}

        {data.payments.length > 0 && (
          <div>
            <Typography.Title level={5}>{t("chargeDetail.payments")}</Typography.Title>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data.payments}
              columns={[
                { title: t("contracts.receivedDate"), dataIndex: "receivedDate" },
                { title: t("contracts.paymentMethod"), dataIndex: "paymentMethod", render: (v: string | null) => (v ? paymentMethodLabel(t, v) : "") },
                {
                  title: t("contracts.amount"),
                  dataIndex: "amountFen",
                  align: "right" as const,
                  render: (v: number) => <Typography.Text type={v < 0 ? "danger" : undefined}>{v < 0 ? `${yuan(v)} (${t("chargeDetail.reversed")})` : yuan(v)}</Typography.Text>,
                },
              ]}
            />
          </div>
        )}

        {data.adjustments.length > 0 && (
          <div>
            <Typography.Title level={5}>{t("contracts.adjustments")}</Typography.Title>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data.adjustments}
              columns={[
                { title: t("chargeDetail.created"), dataIndex: "createdAt", render: (v: string) => v.slice(0, 10) },
                { title: t("chargeDetail.reason"), dataIndex: "reason" },
                { title: t("contracts.amount"), dataIndex: "amountFen", align: "right" as const, render: (v: number) => yuan(v) },
              ]}
            />
          </div>
        )}
      </Space>
    );
  }

  return (
    <Drawer
      open={chargeId !== null}
      onClose={onClose}
      width={Math.min(580, typeof window === "undefined" ? 580 : window.innerWidth)}
      title={c ? `${item} · ${periodLabel(c.serviceStart, c.serviceEnd)}` : t("chargeDetail.title")}
      extra={
        <Space>
          <Button icon={<PrinterOutlined />} onClick={print} disabled={!data}>
            {t("chargeDetail.print")}
          </Button>
          {canVoid && (
            <Button danger onClick={() => onVoid!(c!.id)}>
              {t("billing.void.button")}
            </Button>
          )}
        </Space>
      }
      destroyOnClose
    >
      {body}
    </Drawer>
  );
}
