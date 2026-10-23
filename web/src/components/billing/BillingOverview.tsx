import { useEffect, useState } from "react";
import {
  Alert,
  Card,
  Col,
  Collapse,
  Grid,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { camel, streamName, yuan } from "./format";
import BillRows from "./BillRows";
import ChargeDetailDrawer from "./ChargeDetailDrawer";

type ItemStatus = "overdue" | "due" | "upcoming" | "projected";

interface Item {
  chargeId: number | null;
  /** Only on a bill not made yet: which item and period it is. */
  pricingStreamId?: number;
  serviceEnd?: string;
  feeType: string;
  itemName: string | null;
  serviceStart: string;
  dueDate: string;
  amountFen: number;
  status: ItemStatus;
  daysOverdue: number;
}
type ProjectedRef = { contractId: number; pricingStreamId: number; serviceStart: string; serviceEnd: string };

interface ContractRow {
  contractId: number;
  referenceNumber: string;
  tenantName: string;
  overdueFen: number;
  dueFen: number;
  upcomingFen: number;
  projectedFen: number;
  nextDueDate: string | null;
  nextDueFen: number;
  items: Item[];
}
interface Overview {
  asOf: string;
  totals: {
    overdueFen: number;
    overdueCount: number;
    dueFen: number;
    dueCount: number;
    upcomingFen: number;
    projectedFen: number;
  };
  contracts: ContractRow[];
  missingReadings: {
    contractId: number;
    referenceNumber: string;
    tenantName: string;
    stream: string;
    feeType: string;
    month: string;
  }[];
  depositIssues: {
    contractId: number;
    referenceNumber: string;
    tenantName: string;
    requiredFen: number;
    heldFen: number;
    shortfallFen: number;
    manual: boolean;
  }[];
  notAutoBilled: {
    contractId: number;
    referenceNumber: string;
    tenantName: string;
    reason: "off" | "not_monthly";
  }[];
}

const statusColor: Record<ItemStatus, string> = {
  overdue: "red",
  due: "orange",
  upcoming: "blue",
  projected: "default",
};

/** What each logged-in user needs first: who owes what right now, what comes
 * due next, and the one thing the system can't do for them — meter readings. */
export default function BillingOverview() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [detailChargeId, setDetailChargeId] = useState<number | null>(null);
  const [detailProjected, setDetailProjected] = useState<ProjectedRef | null>(null);
  // A bill opens its details; a bill not made yet opens its preview.
  const openItem = (contractId: number, i: Item) => {
    if (i.chargeId !== null) setDetailChargeId(i.chargeId);
    else if (i.pricingStreamId !== undefined && i.serviceEnd !== undefined) setDetailProjected({ contractId, pricingStreamId: i.pricingStreamId, serviceStart: i.serviceStart, serviceEnd: i.serviceEnd });
  };
  const isPhone = !Grid.useBreakpoint().md;

  useEffect(() => {
    void api.get<Overview>("/billing/overview").then(setData);
  }, []);

  if (!data) return null;

  const canSeeSetup = user?.role === "admin" || user?.role === "manager";
  const offContracts = data.notAutoBilled.filter((c) => c.reason === "off");
  const manualContracts = data.notAutoBilled.filter(
    (c) => c.reason === "not_monthly",
  );

  const readingsByContract = new Map<
    number,
    {
      label: string;
      months: string[];
      tenantName: string;
      referenceNumber: string;
    }
  >();
  for (const m of data.missingReadings) {
    const key = m.contractId;
    const stream =
      m.stream === m.feeType ? t(`contracts.${camel(m.feeType)}`) : m.stream;
    const g = readingsByContract.get(key) ?? {
      label: stream,
      months: [],
      tenantName: m.tenantName,
      referenceNumber: m.referenceNumber,
    };
    g.months.push(m.month);
    readingsByContract.set(key, g);
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title level={5}>
        {t("billing.overview.title")}
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={`${t("billing.overview.overdue")} (${data.totals.overdueCount})`}
              value={yuan(data.totals.overdueFen)}
              valueStyle={{
                color: data.totals.overdueFen > 0 ? "#cf1322" : undefined,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={`${t("billing.overview.dueNow")} (${data.totals.dueCount})`}
              value={yuan(data.totals.dueFen)}
              valueStyle={{
                color: data.totals.dueFen > 0 ? "#d46b08" : undefined,
              }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("billing.overview.dueLater")}
              value={yuan(data.totals.upcomingFen)}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title={t("billing.overview.nextMonth")}
              value={yuan(data.totals.projectedFen)}
            />
          </Card>
        </Col>
      </Row>

      {readingsByContract.size > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={t("billing.overview.readingsTitle", {
            count: data.missingReadings.length,
          })}
          description={
            <>
              <div>{t("billing.overview.readingsBody")}</div>
              {Array.from(readingsByContract.entries()).map(
                ([contractId, g]) => (
                  <div key={contractId}>
                    <Link to={`/contracts/${contractId}`}>
                      {g.referenceNumber}
                    </Link>{" "}
                    · {g.tenantName} · {g.label}: {g.months.join(", ")}
                  </div>
                ),
              )}
            </>
          }
        />
      )}

      {data.depositIssues.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          message={t("billing.overview.depositTitle", {
            count: data.depositIssues.length,
          })}
          description={data.depositIssues.map((d) => (
            <div key={d.contractId}>
              <Link to={`/contracts/${d.contractId}`}>{d.referenceNumber}</Link>{" "}
              · {d.tenantName} ·{" "}
              {d.manual
                ? t("billing.overview.depositManual")
                : t("billing.overview.depositShort", {
                    held: yuan(d.heldFen),
                    required: yuan(d.requiredFen),
                    shortfall: yuan(d.shortfallFen),
                  })}
            </div>
          ))}
        />
      )}

      {canSeeSetup && offContracts.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={t("billing.overview.notBilledTitle", {
            count: offContracts.length,
          })}
          description={
            <>
              <div>{t("billing.overview.notBilledBody")}</div>
              {offContracts.map((c) => (
                <div key={c.contractId}>
                  <Link to={`/contracts/${c.contractId}`}>
                    {c.referenceNumber}
                  </Link>{" "}
                  · {c.tenantName}
                </div>
              ))}
            </>
          }
        />
      )}
      {canSeeSetup && manualContracts.length > 0 && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message={t("billing.overview.manualTitle", {
            count: manualContracts.length,
          })}
          description={manualContracts.map((c) => (
            <div key={c.contractId}>
              <Link to={`/contracts/${c.contractId}`}>{c.referenceNumber}</Link>{" "}
              · {c.tenantName}
            </div>
          ))}
        />
      )}

      {isPhone ? (
        // On a phone each contract is a card: what it owes, then its bills under a fold.
        <div style={{ marginTop: 16 }}>
          {data.contracts.length === 0 && (
            <Typography.Text type="secondary">
              {t("billing.overview.empty")}
            </Typography.Text>
          )}
          {data.contracts.map((row) => (
            <Card
              key={row.contractId}
              size="small"
              style={{ marginBottom: 12 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Typography.Text strong>{row.tenantName}</Typography.Text>
                <Link to={`/contracts/${row.contractId}`}>
                  {row.referenceNumber}
                </Link>
              </div>
              <Space size={12} wrap style={{ marginTop: 6 }}>
                {row.overdueFen > 0 && (
                  <Typography.Text type="danger" strong>
                    {t("billing.overview.overdue")} {yuan(row.overdueFen)}
                  </Typography.Text>
                )}
                {row.dueFen > 0 && (
                  <Typography.Text>
                    {t("billing.overview.dueNow")} {yuan(row.dueFen)}
                  </Typography.Text>
                )}
                {row.upcomingFen > 0 && (
                  <Typography.Text type="secondary">
                    {t("billing.overview.dueLater")} {yuan(row.upcomingFen)}
                  </Typography.Text>
                )}
              </Space>
              {row.nextDueDate && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t("billing.overview.nextDue")}: {row.nextDueDate} ·{" "}
                    {yuan(row.nextDueFen)}
                  </Typography.Text>
                </div>
              )}
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: "bills",
                    label: t("billing.overview.billsCount", {
                      count: row.items.length,
                    }),
                    children: (
                      <BillRows
                        rows={row.items.map((i) => ({
                          key: `${i.chargeId ?? "p"}-${i.feeType}-${i.serviceStart}`,
                          name: streamName(
                            t,
                            i.itemName ?? i.feeType,
                            i.feeType,
                          ),
                          period: i.serviceStart.slice(0, 7),
                          detail: `${t("contracts.dueDate")} ${i.dueDate}`,
                          amountFen: i.amountFen,
                          status: (
                            <Tag color={statusColor[i.status]}>
                              {i.status === "overdue"
                                ? t("contracts.overdueDays", {
                                    days: i.daysOverdue,
                                  })
                                : t(`billing.overview.status.${i.status}`)}
                            </Tag>
                          ),
                          onClick: () => openItem(row.contractId, i),
                        }))}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          ))}
        </div>
      ) : (
        <Table
          style={{ marginTop: 16 }}
          size="small"
          rowKey="contractId"
          dataSource={data.contracts}
          pagination={{ pageSize: 15, hideOnSinglePage: true, size: "small" }}
          locale={{ emptyText: t("billing.overview.empty") }}
          scroll={{ x: 760 }}
          expandable={{
            expandedRowRender: (row: ContractRow) => (
              <Table
                size="small"
                rowKey={(i: Item) =>
                  `${i.chargeId ?? "p"}-${i.feeType}-${i.serviceStart}`
                }
                dataSource={row.items}
                pagination={false}
                onRow={(i: Item) => ({
                  onClick: () => openItem(row.contractId, i),
                  style: { cursor: "pointer" },
                })}
                columns={[
                  {
                    title: t("contracts.fee"),
                    dataIndex: "feeType",
                    render: (_: string, i: Item) =>
                      streamName(t, i.itemName ?? i.feeType, i.feeType),
                  },
                  {
                    title: t("billing.month"),
                    dataIndex: "serviceStart",
                    render: (v: string) => v.slice(0, 7),
                  },
                  { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                  {
                    title: t("contracts.amount"),
                    dataIndex: "amountFen",
                    align: "right" as const,
                    render: yuan,
                  },
                  {
                    title: t("common.actions"),
                    dataIndex: "status",
                    render: (s: ItemStatus, i: Item) => (
                      <Tag color={statusColor[s]}>
                        {s === "overdue"
                          ? t("contracts.overdueDays", { days: i.daysOverdue })
                          : t(`billing.overview.status.${s}`)}
                      </Tag>
                    ),
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: t("billing.overview.tenant"), dataIndex: "tenantName" },
            {
              title: t("contracts.reference"),
              key: "ref",
              render: (_: unknown, r: ContractRow) => (
                <Link to={`/contracts/${r.contractId}`}>
                  {r.referenceNumber}
                </Link>
              ),
            },
            {
              title: t("billing.overview.overdue"),
              dataIndex: "overdueFen",
              align: "right" as const,
              render: (v: number) =>
                v > 0 ? (
                  <Typography.Text type="danger" strong>
                    {yuan(v)}
                  </Typography.Text>
                ) : (
                  "—"
                ),
            },
            {
              title: t("billing.overview.dueNow"),
              dataIndex: "dueFen",
              align: "right" as const,
              render: (v: number) => (v > 0 ? yuan(v) : "—"),
            },
            {
              title: t("billing.overview.dueLater"),
              dataIndex: "upcomingFen",
              align: "right" as const,
              render: (v: number) => (v > 0 ? yuan(v) : "—"),
            },
            {
              title: t("billing.overview.nextMonth"),
              dataIndex: "projectedFen",
              align: "right" as const,
              render: (v: number) => (v > 0 ? yuan(v) : "—"),
            },
            {
              title: t("billing.overview.nextDue"),
              key: "next",
              render: (_: unknown, r: ContractRow) =>
                r.nextDueDate
                  ? `${r.nextDueDate} · ${yuan(r.nextDueFen)}`
                  : "—",
            },
          ]}
        />
      )}
      <ChargeDetailDrawer
        chargeId={detailChargeId}
        projected={detailProjected}
        onClose={() => {
          setDetailChargeId(null);
          setDetailProjected(null);
        }}
      />
    </div>
  );
}
