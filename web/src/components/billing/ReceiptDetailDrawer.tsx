import { useEffect, useState, type ReactNode } from "react";
import { Alert, Button, Descriptions, Drawer, Space, Spin, Table, Tag, Typography } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../api/errorMessage";
import { paymentMethodLabel, periodLabel, streamName, yuan } from "./format";
import { esc, printHtml } from "./print";

interface Detail {
  receipt: {
    id: number;
    contractId: number;
    contractRef: string | null;
    contractStatus: string | null;
    receivedDate: string;
    amountFen: number;
    paymentMethod: string;
    externalReference: string | null;
    status: "posted" | "reversed";
    removedAt: string | null;
    recordedBy: string | null;
    createdAt: string;
    reversedAt: string | null;
    reversedBy: string | null;
    reverseReason: string | null;
  };
  allocatedFen: number;
  unallocatedFen: number;
  allocations: {
    id: number;
    chargeId: number;
    amountFen: number;
    reversal: boolean;
    appliedAt: string;
    by: string | null;
    feeType: string | null;
    itemName: string | null;
    serviceStart: string | null;
    serviceEnd: string | null;
    dueDate: string | null;
  }[];
}

/** Side panel with everything about one receipt: who recorded it, which bills it paid, what is still unallocated. */
export default function ReceiptDetailDrawer({
  receiptId,
  onClose,
  onAllocate,
  onOpenCharge,
}: {
  receiptId: number | null;
  onClose: () => void;
  /** Offered when the receipt still has money to apply. */
  onAllocate?: (receiptId: number) => void;
  /** Open one of the bills the receipt paid. */
  onOpenCharge?: (chargeId: number) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (receiptId === null) return;
    api
      .get<Detail>(`/receipts/${receiptId}`)
      .then(setData)
      .catch((err) => setError(apiErrorMessage(err, t)));
  }, [receiptId, t]);

  const r = data?.receipt;
  const billName = (a: Detail["allocations"][number]) => (a.itemName && a.feeType ? streamName(t, a.itemName, a.feeType) : `#${a.chargeId}`);
  const canAllocate = !!(onAllocate && r && r.status === "posted" && r.contractStatus !== "draft" && (data?.unallocatedFen ?? 0) > 0);

  const statusTag = () => {
    if (!r) return null;
    if (r.removedAt) return <Tag>{t("contracts.removed")}</Tag>;
    if (r.status === "reversed") return <Tag color="red">{t("contracts.reversed")}</Tag>;
    return <Tag color="green">{t("receiptDetail.posted")}</Tag>;
  };

  const print = () => {
    if (!data || !r) return;
    const rows = data.allocations
      .map((a) => `<tr><td>${esc(billName(a))}</td><td>${esc(a.serviceStart && a.serviceEnd ? periodLabel(a.serviceStart, a.serviceEnd) : "")}</td><td>${esc(a.dueDate ?? "")}</td><td class="r">${esc(yuan(a.amountFen))}</td></tr>`)
      .join("");
    printHtml(
      `${r.contractRef ?? ""} ${t("receiptDetail.title")}`,
      `<h1>${esc(`${r.contractRef ?? ""} · ${t("receiptDetail.title")} · ${r.receivedDate}`)}</h1>
<table><tr><th>${esc(t("contracts.paymentMethod"))}</th><td>${esc(paymentMethodLabel(t, r.paymentMethod))}</td><th>${esc(t("contracts.amount"))}</th><td class="r">${esc(yuan(r.amountFen))}</td></tr>
<tr><th>${esc(t("receiptDetail.appliedSoFar"))}</th><td class="r">${esc(yuan(data.allocatedFen))}</td><th>${esc(t("contracts.unallocated"))}</th><td class="r">${esc(yuan(data.unallocatedFen))}</td></tr>
${r.externalReference ? `<tr><th>${esc(t("receiptDetail.reference"))}</th><td colspan="3">${esc(r.externalReference)}</td></tr>` : ""}</table>
${rows ? `<h2>${esc(t("receiptDetail.appliedTo"))}</h2><table>${rows}</table>` : ""}`,
    );
  };

  let body: ReactNode = <Spin />;
  if (error) body = <Alert type="error" showIcon message={error} />;
  else if (data && r) {
    body = (
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>{statusTag()}</Space>
        {r.removedAt && <Alert type="warning" showIcon message={t("receiptDetail.removedNote", { when: r.removedAt.slice(0, 10) })} />}
        {r.status === "reversed" && !r.removedAt && (
          <Alert type="warning" showIcon message={t("receiptDetail.reversedBy", { who: r.reversedBy ?? "—", when: (r.reversedAt ?? "").slice(0, 10) })} description={r.reverseReason || undefined} />
        )}
        {r.paymentMethod === "deposit_transfer" && <Alert type="info" showIcon message={t("receiptDetail.depositTransferNote")} />}
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label={t("audit.fields.contract")}>
            <Link to={`/contracts/${r.contractId}`}>{r.contractRef}</Link>
          </Descriptions.Item>
          <Descriptions.Item label={t("contracts.receivedDate")}>{r.receivedDate}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.paymentMethod")}>{paymentMethodLabel(t, r.paymentMethod)}</Descriptions.Item>
          {r.externalReference && <Descriptions.Item label={t("receiptDetail.reference")}>{r.externalReference}</Descriptions.Item>}
          <Descriptions.Item label={t("contracts.amount")}>
            <Typography.Text strong>{yuan(r.amountFen)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t("receiptDetail.appliedSoFar")}>{yuan(data.allocatedFen)}</Descriptions.Item>
          <Descriptions.Item label={t("contracts.unallocated")}>
            <Typography.Text strong type={data.unallocatedFen > 0 && r.status === "posted" ? "warning" : undefined}>
              {yuan(data.unallocatedFen)}
            </Typography.Text>
          </Descriptions.Item>
          {r.recordedBy && <Descriptions.Item label={t("receiptDetail.recordedBy")}>{r.recordedBy}</Descriptions.Item>}
          <Descriptions.Item label={t("chargeDetail.created")}>{r.createdAt.slice(0, 10)}</Descriptions.Item>
        </Descriptions>

        <div>
          <Typography.Title level={5}>{t("receiptDetail.appliedTo")}</Typography.Title>
          {data.allocations.length === 0 ? (
            <Typography.Text type="secondary">{t("receiptDetail.noneApplied")}</Typography.Text>
          ) : (
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data.allocations}
              scroll={{ x: true }}
              onRow={(a) => (onOpenCharge ? { onClick: () => onOpenCharge(a.chargeId), style: { cursor: "pointer" } } : {})}
              columns={[
                {
                  title: t("contracts.fee"),
                  render: (_: unknown, a: Detail["allocations"][number]) => (
                    <div>
                      <div>{billName(a)}</div>
                      {a.serviceStart && a.serviceEnd && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{periodLabel(a.serviceStart, a.serviceEnd)}</Typography.Text>}
                    </div>
                  ),
                },
                { title: t("contracts.dueDate"), dataIndex: "dueDate", render: (v: string | null) => v ?? "" },
                {
                  title: t("contracts.amount"),
                  dataIndex: "amountFen",
                  align: "right" as const,
                  render: (v: number) => <Typography.Text type={v < 0 ? "danger" : undefined}>{v < 0 ? `${yuan(v)} (${t("chargeDetail.reversed")})` : yuan(v)}</Typography.Text>,
                },
              ]}
            />
          )}
        </div>
      </Space>
    );
  }

  return (
    <Drawer
      open={receiptId !== null}
      onClose={onClose}
      width={Math.min(580, typeof window === "undefined" ? 580 : window.innerWidth)}
      title={r ? `${t("receiptDetail.title")} · ${r.receivedDate} · ${yuan(r.amountFen)}` : t("receiptDetail.title")}
      extra={
        <Space>
          <Button icon={<PrinterOutlined />} onClick={print} disabled={!data}>
            {t("chargeDetail.print")}
          </Button>
          {canAllocate && (
            <Button type="primary" onClick={() => onAllocate!(r!.id)}>
              {t("contracts.allocate")}
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
