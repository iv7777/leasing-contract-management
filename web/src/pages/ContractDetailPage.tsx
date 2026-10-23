import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Grid,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Statistic,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import { PlusOutlined, ThunderboltOutlined, DownloadOutlined, FilePdfOutlined, UploadOutlined, LockOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { FormInstance } from "antd";
import { useTranslation } from "react-i18next";
import { todayInChina, type PartyDto } from "@lcm/shared";
import { api, ApiError } from "../api/client";
import { apiErrorMessage } from "../api/errorMessage";
import { useAuth } from "../auth/AuthContext";
import { useHelpTopic } from "../help/HelpContext";
import { HelpIcon } from "../help/HelpIcon";
import DateField from "../components/DateField";
import MonthField from "../components/MonthField";
import CatchUpBillingModal from "../components/billing/CatchUpBillingModal";
import OpeningBalancePanel from "../components/billing/OpeningBalancePanel";
import { MeterPhotoCell, PhotoPicker, uploadMeterPhoto } from "../components/billing/MeterPhoto";
import ChargeDetailDrawer from "../components/billing/ChargeDetailDrawer";
import BillRows from "../components/billing/BillRows";
import RecordPaymentModal from "../components/billing/RecordPaymentModal";
import BulkPaymentsModal from "../components/billing/BulkPaymentsModal";
import { paymentMethodLabel, docTypeLabel, docDisplayName, PAYMENT_METHODS, timeLeft, isMeteredMethod, impliedPrice, priceDeviation, PRICE_JUMP, periodLabel } from "../components/billing/format";
import UpcomingBillsTab from "../components/billing/UpcomingBillsTab";
import MeterReadingsGridModal from "../components/billing/MeterReadingsGridModal";

interface ContractDto {
  id: number;
  referenceNumber: string;
  landlordPartyId: number;
  tenantPartyId: number;
  termStart: string;
  termEnd: string;
  status: "draft" | "active" | "expired" | "terminated";
  versionNumber: number;
  archived: boolean;
  specialTerms: string | null;
}
interface BillingRulesDto {
  billingFrequency: "monthly" | "quarterly" | "yearly";
  autoBilling: boolean;
  overdueGraceDays: number;
  dueDay: number;
  dueMonthOffset: number;
  latePenaltyEnabled: boolean;
  latePenaltyDailyRatePermille: string | null;
  latePenaltyCapFen: number | null;
}
interface ContractUnitDto {
  id: number;
  unitId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  contractedAreaSqm: string;
}
interface PricingStreamDto {
  id: number;
  feeType: string;
  targetType: string;
  label: string | null;
}
interface RateScheduleDto {
  id: number;
  pricingStreamId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  calculationMethod: string;
  amountOrRate: string;
  rateBasis: string;
  escalationBase: string | null;
  escalationPercentage: string | null;
  escalationIntervalMonths: number | null;
  unit: string | null;
  linkedStreamId: number | null;
}
interface UsageEntryDto {
  id: number;
  pricingStreamId: number;
  serviceStart: string;
  serviceEnd: string;
  quantity: string;
  amountFen?: number | null;
  unit: string;
  source: string | null;
  billed?: boolean;
  canEdit?: boolean;
  lockReason?: "paid" | "expired" | "not_yours" | null;
  editableUntil?: string | null;
  photoDocumentId?: number | null;
  photoMissing?: boolean;
}
interface ConcessionDto {
  id: number;
  pricingStreamId: number | null;
  effectiveStart: string;
  effectiveEnd: string;
  discountPercentage: string;
  reason: string | null;
}
interface DepositTermsDto {
  id: number;
  effectiveStart: string;
  requirementType: string;
  fixedAmountFen: number | null;
  formulaBasis: string | null;
}
interface ChargeDto {
  id: number;
  pricingStreamId: number;
  feeType: string;
  serviceStart: string;
  serviceEnd: string;
  dueDate: string;
  amountFen: number;
  status: "posted" | "voided";
  voidReason: string | null;
  calculationSnapshotJson?: string;
}
interface AmendmentDto {
  id: number;
  type: string;
  reason: string;
  effectiveDate: string;
  status: "draft" | "pending" | "approved" | "rejected" | "withdrawn";
  baseContractVersion: number;
  supportingDocumentId: number | null;
  createdBy: number | null;
  submittedBy: number | null;
}
interface ChargeBalanceDto {
  chargeId: number;
  billedFen: number;
  adjustedFen: number;
  allocatedFen: number;
  balanceFen: number;
  isOverdue: boolean;
  daysOverdue: number;
}
interface ReceiptDto {
  id: number;
  receivedDate: string;
  amountFen: number;
  paymentMethod: string;
  externalReference: string | null;
  status: "posted" | "reversed";
  removedAt?: string | null;
  canEdit?: boolean;
  editableUntil?: string | null;
}
interface ReceiptBalanceDto {
  receiptId: number;
  unallocatedFen: number;
}
interface DepositTransactionDto {
  id: number;
  transactionType: string;
  amountFen: number;
  transactionDate: string;
  reason: string;
  reversalOfId: number | null;
  removedAt?: string | null;
  canEdit?: boolean;
  editableUntil?: string | null;
}
interface DepositStatusDto {
  requiredFen: number;
  waivedFen: number;
  heldFen: number;
  shortfallFen: number;
  needsManualCheck: boolean;
  state: "none" | "ok" | "short" | "manual";
}
interface DocumentDto {
  id: number;
  name: string | null;
  docType: string;
  classification: "ordinary" | "sensitive";
  mimeType: string;
  uploadedAt: string;
  uploadedByName: string | null;
  voided: boolean;
  fileMissing?: boolean;
}
interface StatementDto {
  periodStart: string;
  periodEnd: string;
  openingReceivableFen: number;
  newChargesFen: number;
  adjustmentsFen: number;
  receiptsAppliedFen: number;
  closingReceivableFen: number;
  unallocatedReceiptsFen: number;
  depositBalanceFen: number;
}
const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

/** Usual unit for a metered fee, prefilled on a new usage entry or metered rate:
 * 度 / 立方米 in Chinese, kWh / m³ in English. */
const METER_UNITS: Record<"en" | "zh", Record<string, string>> = {
  en: { electricity_base: "kWh", water: "m³" },
  zh: { electricity_base: "度", water: "立方米" },
};
const AUTO_UNITS = ["kWh", "m³", "度", "立方米"];
const defaultMeterUnit = (feeType: string | undefined, lang: string): string | undefined =>
  feeType ? METER_UNITS[lang.startsWith("zh") ? "zh" : "en"][feeType] : undefined;

const isoDay = (d: dayjs.Dayjs) => d.format("YYYY-MM-DD");
/** "YYYY-MM-DD" + n months − 1 day: the last day of an n-month stretch starting on `start`. */
const monthsFrom = (start: string, n: number) => isoDay(dayjs(start).add(n, "month").subtract(1, "day"));
const firstOfNextMonth = () => isoDay(dayjs(todayInChina()).add(1, "month").startOf("month"));

/** First and last day of the month `offset` months from today ("YYYY-MM-DD"). */
function monthRange(offset: number): { start: string; end: string } {
  const m = dayjs(todayInChina()).add(offset, "month");
  return { start: m.startOf("month").format("YYYY-MM-DD"), end: m.endOf("month").format("YYYY-MM-DD") };
}

/** One-tap fill of Service start / Service end with a whole month. */
function MonthShortcuts({ form }: { form: FormInstance }) {
  const { t } = useTranslation();
  const fill = (offset: number) => {
    const { start, end } = monthRange(offset);
    form.setFieldsValue({ serviceStart: start, serviceEnd: end });
  };
  return (
    <Space size={8} style={{ marginBottom: 12 }} wrap>
      <Typography.Text type="secondary">{t("contracts.quickFill")}</Typography.Text>
      <Button size="small" onClick={() => fill(-1)}>
        {t("contracts.lastMonth")}
      </Button>
      <Button size="small" onClick={() => fill(0)}>
        {t("contracts.thisMonth")}
      </Button>
    </Space>
  );
}

const feeTypes = ["rent", "management", "electricity_base", "water", "elevator", "other"] as const;
const rateBases = ["per_month", "per_quarter", "per_year", "per_sqm_per_month", "per_unit", "percent_of_usage"] as const;
const isUsageFee = (method?: string) => method === "usage_fee_per_unit" || method === "usage_fee_percent";
const usageFeeBasis = (method: string) => (method === "usage_fee_percent" ? "percent_of_usage" : "per_unit");
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const exportLang = i18n.language.startsWith("zh") ? "zh" : "en";
  const { user } = useAuth();
  const isPhone = !Grid.useBreakpoint().md;

  const [contract, setContract] = useState<ContractDto | null>(null);
  const [billingRulesInfo, setBillingRulesInfo] = useState<BillingRulesDto | null>(null);
  const [units, setUnits] = useState<ContractUnitDto[]>([]);
  const [streams, setStreams] = useState<PricingStreamDto[]>([]);
  const [streamUnitLinks, setStreamUnitLinks] = useState<{ pricingStreamId: number; contractUnitId: number }[]>([]);
  const [rates, setRates] = useState<RateScheduleDto[]>([]);
  const [usageEntries, setUsageEntries] = useState<UsageEntryDto[]>([]);
  const [concessions, setConcessions] = useState<ConcessionDto[]>([]);
  const [depositTerms, setDepositTerms] = useState<DepositTermsDto[]>([]);
  const [charges, setCharges] = useState<ChargeDto[]>([]);
  const [chargeBalances, setChargeBalances] = useState<ChargeBalanceDto[]>([]);
  const [receipts, setReceipts] = useState<ReceiptDto[]>([]);
  const [receiptBalances, setReceiptBalances] = useState<ReceiptBalanceDto[]>([]);
  const [depositTxns, setDepositTxns] = useState<DepositTransactionDto[]>([]);
  const [depositBalanceFen, setDepositBalanceFen] = useState(0);
  const [depositStatus, setDepositStatus] = useState<DepositStatusDto | null>(null);
  const [statement, setStatement] = useState<StatementDto | null>(null);
  const [statementPeriod, setStatementPeriod] = useState(todayInChina().slice(0, 7));
  const [amendments, setAmendments] = useState<AmendmentDto[]>([]);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [availableUnits, setAvailableUnits] = useState<{ id: number; unitLabel: string; propertyId: number; rentableAreaSqm?: string }[]>([]);
  const [allDocuments, setDocuments] = useState<DocumentDto[]>([]);
  const [showVoidedDocs, setShowVoidedDocs] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  // Voided documents (withdrawn by an approved amendment) are kept on record but are never offered for new work.
  const documents = allDocuments.filter((d) => !d.voided);
  const [activeTab, setActiveTab] = useState("units");
  useHelpTopic(`contracts.detail.${activeTab}`);

  const [docModal, setDocModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docForm] = Form.useForm();
  const [editModal, setEditModal] = useState(false);
  const [editForm] = Form.useForm();
  const [unitModal, setUnitModal] = useState(false);
  const [streamModal, setStreamModal] = useState(false);
  const [concessionModal, setConcessionModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [generateModal, setGenerateModal] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [bulkPaymentOpen, setBulkPaymentOpen] = useState(false);
  const [readingsGridOpen, setReadingsGridOpen] = useState(false);
  const [voidModal, setVoidModal] = useState<{ chargeId: number } | null>(null);
  const [voidForm] = Form.useForm();
  const [amendmentModal, setAmendmentModal] = useState(false);
  const [receiptModal, setReceiptModal] = useState(false);
  const [allocateModal, setAllocateModal] = useState<{ receiptId: number } | null>(null);
  const [editReceiptModal, setEditReceiptModal] = useState<ReceiptDto | null>(null);
  const [editDepositTxnModal, setEditDepositTxnModal] = useState<DepositTransactionDto | null>(null);
  const [reverseReceiptModal, setReverseReceiptModal] = useState<{ receiptId: number } | null>(null);
  const [depositTxnModal, setDepositTxnModal] = useState(false);
  const [depositTxnType, setDepositTxnType] = useState("receipt");
  const [amendmentKind, setAmendmentKind] = useState<"rate_change" | "add_unit" | "add_pricing_stream" | "terminate" | "void_document" | "billing_rules">("rate_change");
  const [amendmentStreamTargetType, setAmendmentStreamTargetType] = useState("unit");
  const [editAmendment, setEditAmendment] = useState<AmendmentDto | null>(null);
  const [rejectAmendmentModal, setRejectAmendmentModal] = useState<{ amendmentId: number } | null>(null);
  const [reverseDepositTxnModal, setReverseDepositTxnModal] = useState<{ depositTxnId: number } | null>(null);
  const [latePenaltyModal, setLatePenaltyModal] = useState(false);
  const [latePenaltyEnabled, setLatePenaltyEnabled] = useState(false);
  const [editUnitModal, setEditUnitModal] = useState<ContractUnitDto | null>(null);
  const [editStreamModal, setEditStreamModal] = useState<PricingStreamDto | null>(null);
  const [rateModal, setRateModal] = useState<{ streamId: number; rate?: RateScheduleDto } | null>(null);
  const [usageEntryModal, setUsageEntryModal] = useState(false);
  const [editUsageEntryModal, setEditUsageEntryModal] = useState<UsageEntryDto | null>(null);
  const [detailChargeId, setDetailChargeId] = useState<number | null>(null);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [editPhoto, setEditPhoto] = useState<File | null>(null);
  const [editConcessionModal, setEditConcessionModal] = useState<ConcessionDto | null>(null);
  const [editDepositModal, setEditDepositModal] = useState<DepositTermsDto | null>(null);
  const [editDocModal, setEditDocModal] = useState<DocumentDto | null>(null);
  const [unitForm] = Form.useForm();
  const [streamForm] = Form.useForm();
  const [concessionForm] = Form.useForm();
  const [depositForm] = Form.useForm();
  const [generateForm] = Form.useForm();
  const [amendmentForm] = Form.useForm();
  const [editAmendmentForm] = Form.useForm();
  const [receiptForm] = Form.useForm();
  const [allocateForm] = Form.useForm();
  const [reverseReceiptForm] = Form.useForm();
  const [depositTxnForm] = Form.useForm();
  const [editReceiptForm] = Form.useForm();
  const [editDepositTxnForm] = Form.useForm();
  const [rejectAmendmentForm] = Form.useForm();
  const [reverseDepositTxnForm] = Form.useForm();
  const [latePenaltyForm] = Form.useForm();
  const [editUnitForm] = Form.useForm();
  const [editStreamForm] = Form.useForm();
  const [rateForm] = Form.useForm();
  const [usageEntryForm] = Form.useForm();
  const [editUsageEntryForm] = Form.useForm();
  const [editConcessionForm] = Form.useForm();
  const [editDepositForm] = Form.useForm();
  const [editDocForm] = Form.useForm();
  const streamMethod = Form.useWatch("calculationMethod", streamForm) as string | undefined;
  const rateMethod = Form.useWatch("calculationMethod", rateForm) as string | undefined;
  const amendStreamMethod = Form.useWatch("amendStreamCalculationMethod", amendmentForm) as string | undefined;

  const load = () => {
    void api.get<any>(`/contracts/${id}`).then((r) => {
      setContract(r.contract);
      setBillingRulesInfo(r.billingRules);
      setUnits(r.units);
      setStreams(r.pricingStreams);
      setStreamUnitLinks(r.pricingStreamUnits);
      setRates(r.rateSchedule);
      setConcessions(r.concessions);
      setDepositTerms(r.depositTerms);
    });
    void api.get<{ usageEntries: UsageEntryDto[] }>(`/contracts/${id}/usage-entries`).then((r) => setUsageEntries(r.usageEntries));
    void api.get<{ charges: ChargeDto[] }>(`/contracts/${id}/charges`).then((r) => setCharges(r.charges));
    void api
      .get<{ chargeBalances: ChargeBalanceDto[]; receipts: ReceiptDto[]; receiptBalances: ReceiptBalanceDto[] }>(`/contracts/${id}/ledger`)
      .then((r) => {
        setChargeBalances(r.chargeBalances);
        setReceipts(r.receipts);
        setReceiptBalances(r.receiptBalances);
      });
    void api
      .get<{ transactions: DepositTransactionDto[]; balanceFen: number; status: DepositStatusDto }>(`/contracts/${id}/deposit-transactions`)
      .then((r) => {
        setDepositTxns(r.transactions);
        setDepositBalanceFen(r.balanceFen);
        setDepositStatus(r.status);
      });
    void api.get<{ amendments: AmendmentDto[] }>(`/contracts/${id}/amendments`).then((r) => setAmendments(r.amendments));
    void api.get<{ documents: DocumentDto[] }>(`/documents?ownerType=contract&ownerId=${id}&includeVoided=true`).then((r) => setDocuments(r.documents));
    void api.get<{ parties: PartyDto[] }>("/parties").then((r) => setParties(r.parties));
    void api.get<{ properties: { id: number }[] }>("/properties").then(async (r) => {
      const allUnits = await Promise.all(
        r.properties.map((p) => api.get<{ units: { id: number; unitLabel: string; rentableAreaSqm?: string }[] }>(`/properties/${p.id}`).then((u) => u.units.map((x) => ({ ...x, propertyId: p.id })))),
      );
      setAvailableUnits(allUnits.flat());
    });
  };

  useEffect(load, [id]);

  // The statement follows the chosen month and refreshes after payments or new charges.
  useEffect(() => {
    if (!statementPeriod) return;
    api
      .get<{ statement: StatementDto }>(`/contracts/${id}/statement?period=${statementPeriod}`)
      .then((r) => setStatement(r.statement))
      .catch((err) => message.error(apiErrorMessage(err, t)));
  }, [id, statementPeriod, receipts.length, charges.length]);

  // Items whose readings carry their own amount (¥) beside the quantity.
  const amountStreamIds = new Set(streams.filter((s) => rates.some((r) => r.pricingStreamId === s.id && r.calculationMethod === "metered_amount")).map((s) => s.id));
  const newUsageStreamId = Form.useWatch("pricingStreamId", usageEntryForm) as number | undefined;
  const newUsageQuantity = Form.useWatch("quantity", usageEntryForm) as number | undefined;
  const newUsageAmount = Form.useWatch("amount", usageEntryForm) as number | undefined;
  const editUsageQuantity = Form.useWatch("quantity", editUsageEntryForm) as number | undefined;
  const editUsageAmount = Form.useWatch("amount", editUsageEntryForm) as number | undefined;
  /** Price per unit of the latest earlier reading of the same item that has an amount, to spot a slipped decimal. */
  const priceHint = (streamId: number | undefined, before: string | undefined, quantity: number | undefined, amount: number | undefined, unit: string) => {
    if (!streamId || !amountStreamIds.has(streamId)) return null;
    const price = impliedPrice(quantity, amount);
    if (price === null) return null;
    const prev = usageEntries
      .filter((u) => u.pricingStreamId === streamId && u.amountFen != null && (!before || u.serviceStart < before))
      .sort((a, b) => b.serviceStart.localeCompare(a.serviceStart))[0];
    const prevPrice = prev ? impliedPrice(Number(prev.quantity), (prev.amountFen ?? 0) / 100) : null;
    const dev = priceDeviation(price, prevPrice);
    return (
      <div style={{ marginTop: -8, marginBottom: 12 }}>
        <Typography.Text type="secondary">{t("billing.readings.impliedPrice", { price: price.toFixed(4), unit })}</Typography.Text>
        {dev !== null && Math.abs(dev) > PRICE_JUMP && (
          <Alert
            style={{ marginTop: 6 }}
            type="warning"
            showIcon
            message={t("billing.readings.priceJumpLong", { pct: Math.round(Math.abs(dev) * 100), dir: t(dev > 0 ? "billing.readings.higher" : "billing.readings.lower"), prev: prevPrice!.toFixed(4), unit })}
          />
        )}
      </div>
    );
  };

  // ---- Prefills: each form opens with the values you would almost always type. ----
  const termStart = contract?.termStart;
  const areaOfUnit = (unitId?: number) => availableUnits.find((u) => u.id === unitId)?.rentableAreaSqm;
  const feeName = (feeType: string) => t(`contracts.${camel(feeType)}`);
  // Entries taken back during their correction window are out of the way unless asked for.
  const removedDepositIds = new Set(depositTxns.filter((x) => x.removedAt && x.reversalOfId !== null).map((x) => x.reversalOfId));
  const shownReceipts = showRemoved ? receipts : receipts.filter((r) => !r.removedAt);
  const shownDepositTxns = showRemoved ? depositTxns : depositTxns.filter((x) => !x.removedAt && !removedDepositIds.has(x.id));
  // The buttons on a receipt: apply the unallocated part, correct it while that is allowed, reverse it (Admin).
  const receiptActions = (r: ReceiptDto) => (
                    <Space>
                            {(receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0) > 0 && (
                              <Button size="small" onClick={() => setAllocateModal({ receiptId: r.id })}>
                                {t("contracts.allocate")}
                              </Button>
                            )}
                            {r.canEdit && (
                              <Tooltip title={t("contracts.editableFor", { time: timeLeft(r.editableUntil) })}>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editReceiptForm.setFieldsValue({ receivedDate: r.receivedDate, amount: r.amountFen / 100, paymentMethod: r.paymentMethod, externalReference: r.externalReference ?? undefined });
                                    setEditReceiptModal(r);
                                  }}
                                >
                                  {timeLeft(r.editableUntil)}
                                </Button>
                              </Tooltip>
                            )}
                            {r.canEdit && (
                              <Popconfirm title={t("contracts.confirmRemoveReceipt")} okText={t("contracts.removeEntry")} cancelText={t("common.cancel")} onConfirm={() => onRemoveEntry(`/receipts/${r.id}/remove`)}>
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            )}
                            {user?.role === "admin" && (
                              <Button size="small" danger onClick={() => setReverseReceiptModal({ receiptId: r.id })}>
                                {t("contracts.reverse")}
                              </Button>
                            )}
                    </Space>
  );
  // One status tag for a bill: voided, paid, overdue (with days), or what is still owed.
  const chargeStatusTag = (c: ChargeDto, b: { balanceFen: number; isOverdue: boolean; daysOverdue: number } | undefined) => {
    if (c.status === "voided") return <Tag title={c.voidReason ?? undefined}>{t("billing.void.voided")}</Tag>;
    if (!b) return null;
    if (b.balanceFen === 0) return <Tag color="green">{t("chargeDetail.paid")}</Tag>;
    if (b.isOverdue) return <Tag color="red">{t("contracts.overdueDays", { days: b.daysOverdue })} · {yuan(b.balanceFen)}</Tag>;
    return <Tag color="orange">{yuan(b.balanceFen)}</Tag>;
  };
  // A bill is shown by the name of its item (two electricity items would otherwise look the same).
  const itemNameOf = (streamId: number, feeType: string) => streams.find((s) => s.id === streamId)?.label ?? feeName(feeType);
  // A usage service fee follows one of this contract's metered (usage-based) items.
  const meteredStreamOptions = streams
    .filter((s) => rates.some((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod)))
    .map((s) => ({ value: s.id, label: s.label ?? feeName(s.feeType) }));
  const methodOptions = [
    { value: "flat", label: t("contracts.flat") },
    { value: "per_sqm", label: t("contracts.perSqm") },
    { value: "percentage_escalation", label: t("contracts.percentageEscalation") },
    { value: "metered", label: t("contracts.metered") },
    { value: "metered_amount", label: t("contracts.meteredAmount") },
    ...(meteredStreamOptions.length > 0
      ? [
          { value: "usage_fee_per_unit", label: t("contracts.usageFeePerUnit") },
          { value: "usage_fee_percent", label: t("contracts.usageFeePercent") },
        ]
      : []),
  ];
  const linkedStreamField = (name: string) => (
    <Form.Item name={name} label={t("contracts.linkedStream")} extra={t("contracts.linkedStreamHint")} rules={[{ required: true }]}>
      <Select options={meteredStreamOptions} />
    </Form.Item>
  );
  const usageFeeValueExtra = (method?: string) => (method === "usage_fee_percent" ? t("contracts.usageFeePercentHint") : method === "usage_fee_per_unit" ? t("contracts.usageFeePerUnitHint") : undefined);

  useEffect(() => {
    if (unitModal && termStart) unitForm.setFieldsValue({ effectiveStart: termStart });
  }, [unitModal]);

  useEffect(() => {
    if (!streamModal) return;
    streamForm.setFieldsValue({ effectiveStart: termStart, contractUnitIds: units.map((u) => u.id), label: feeName("rent") });
  }, [streamModal]);

  useEffect(() => {
    if (!rateModal || rateModal.rate) return;
    // A new rate row continues the stream: it starts the day after the latest row ends and copies its method, basis and unit.
    const latest = rates
      .filter((r) => r.pricingStreamId === rateModal.streamId)
      .sort((a, b) => (b.effectiveEnd ?? "9999").localeCompare(a.effectiveEnd ?? "9999") || b.effectiveStart.localeCompare(a.effectiveStart))[0];
    if (!latest) return;
    rateForm.setFieldsValue({
      calculationMethod: latest.calculationMethod,
      rateBasis: latest.rateBasis,
      unit: latest.unit ?? undefined,
      linkedStreamId: latest.linkedStreamId ?? undefined,
      effectiveStart: latest.effectiveEnd ? isoDay(dayjs(latest.effectiveEnd).add(1, "day")) : undefined,
    });
  }, [rateModal]);

  useEffect(() => {
    if (concessionModal) concessionForm.setFieldsValue({ effectiveStart: termStart, discountPercentage: 100, reason: t("contracts.freeRentReason") });
  }, [concessionModal]);

  useEffect(() => {
    if (depositModal && termStart) depositForm.setFieldsValue({ effectiveStart: termStart });
  }, [depositModal]);

  useEffect(() => {
    if (receiptModal) receiptForm.setFieldsValue({ receivedDate: todayInChina(), paymentMethod: PAYMENT_METHODS[0] });
  }, [receiptModal]);

  useEffect(() => {
    if (amendmentModal) {
      amendmentForm.setFieldsValue({ effectiveDate: firstOfNextMonth(), amendStreamContractUnitIds: units.map((u) => u.id) });
    }
  }, [amendmentModal]);

  useEffect(() => {
    if (!docModal) return;
    // The signed lease is required to activate, so it is the default until one is on file;
    // after that the usual upload is a signed supplement for an amendment.
    docForm.setFieldsValue({ docType: documents.some((d) => d.docType === "signed_lease") ? "signed_supplement" : "signed_lease" });
  }, [docModal]);

  useEffect(() => {
    if (!usageEntryModal) return;
    // Usage is normally entered for the month that just ended.
    const { start, end } = monthRange(-1);
    const metered = streams.filter((s) => rates.some((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod)));
    usageEntryForm.setFieldsValue({
      serviceStart: start,
      serviceEnd: end,
      ...(metered.length === 1 ? { pricingStreamId: metered[0].id, unit: defaultMeterUnit(metered[0].feeType, i18n.language) } : {}),
    });
  }, [usageEntryModal]);

  // The deposit amount a transaction usually carries: what is still short, or what is held.
  const depositAmountFor = (type: string): number | undefined => {
    if (type === "receipt" && contract?.status === "active" && depositStatus && depositStatus.shortfallFen > 0) return depositStatus.shortfallFen / 100;
    if (type === "refund" && depositBalanceFen > 0) return depositBalanceFen / 100;
    return undefined;
  };
  useEffect(() => {
    if (!depositTxnModal) return;
    depositTxnForm.setFieldsValue({ transactionDate: todayInChina(), amountFen: depositAmountFor(depositTxnForm.getFieldValue("transactionType") ?? "receipt") });
  }, [depositTxnModal]);

  if (!contract) return <Typography.Text>{t("common.loading")}</Typography.Text>;

  const isDraft = contract.status === "draft";
  const canEdit = (user?.role === "admin" || user?.role === "manager") && isDraft;
  const canPropose = user?.role === "admin" || user?.role === "manager";
  const canManageUsage = user?.role === "admin" || user?.role === "manager";
  const partyName = (pid: number) => parties.find((p) => p.id === pid)?.name ?? pid;

  const handleError = (err: unknown) => {
    const text = apiErrorMessage(err, t);
    // A list of problems (why a contract can't be activated) needs its line breaks and a longer read.
    if (text.includes("\n")) message.error({ content: <span style={{ whiteSpace: "pre-line", textAlign: "left", display: "inline-block" }}>{text}</span>, duration: 10 });
    else message.error(text);
  };

  const onAddUnit = async () => {
    try {
      const values = await unitForm.validateFields();
      await api.post(`/contracts/${id}/units`, values);
      setUnitModal(false);
      unitForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddStream = async () => {
    try {
      const values = await streamForm.validateFields();
      const { effectiveStart, calculationMethod, amountOrRate, rateBasis, unit, linkedStreamId, contractUnitIds, ...rest } = values;
      await api.post(`/contracts/${id}/pricing-streams`, {
        ...rest,
        contractUnitIds,
        initialRate: { effectiveStart, calculationMethod, amountOrRate: calculationMethod === "metered_amount" ? "0" : String(amountOrRate), rateBasis, unit, linkedStreamId: isUsageFee(calculationMethod) ? linkedStreamId : undefined },
      });
      setStreamModal(false);
      streamForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddConcession = async () => {
    try {
      const values = await concessionForm.validateFields();
      await api.post(`/contracts/${id}/concessions`, { ...values, discountPercentage: String(values.discountPercentage) });
      setConcessionModal(false);
      concessionForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSetDeposit = async () => {
    try {
      const { depositAmountYuan, ...values } = await depositForm.validateFields();
      await api.post(`/contracts/${id}/deposit-terms`, {
        ...values,
        fixedAmountFen: depositAmountYuan !== undefined ? Math.round(depositAmountYuan * 100) : undefined,
      });
      setDepositModal(false);
      depositForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditContractUnit = async () => {
    if (!editUnitModal) return;
    try {
      const values = await editUnitForm.validateFields();
      await api.patch(`/contracts/${id}/units/${editUnitModal.id}`, values);
      setEditUnitModal(null);
      editUnitForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteContractUnit = async (contractUnitId: number) => {
    try {
      await api.delete(`/contracts/${id}/units/${contractUnitId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditStream = async () => {
    if (!editStreamModal) return;
    try {
      const values = await editStreamForm.validateFields();
      await api.patch(`/contracts/${id}/pricing-streams/${editStreamModal.id}`, values);
      setEditStreamModal(null);
      editStreamForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteStream = async (streamId: number) => {
    try {
      await api.delete(`/contracts/${id}/pricing-streams/${streamId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSaveRate = async () => {
    if (!rateModal) return;
    try {
      const values = await rateForm.validateFields();
      const payload = { ...values, amountOrRate: values.calculationMethod === "metered_amount" ? "0" : String(values.amountOrRate), linkedStreamId: isUsageFee(values.calculationMethod) ? values.linkedStreamId : undefined };
      if (rateModal.rate) {
        await api.patch(`/contracts/${id}/pricing-streams/${rateModal.streamId}/rate-schedule/${rateModal.rate.id}`, payload);
      } else {
        await api.post(`/contracts/${id}/pricing-streams/${rateModal.streamId}/rate-schedule`, payload);
      }
      setRateModal(null);
      rateForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteRate = async (streamId: number, rateId: number) => {
    try {
      await api.delete(`/contracts/${id}/pricing-streams/${streamId}/rate-schedule/${rateId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAddUsageEntry = async () => {
    try {
      const values = await usageEntryForm.validateFields();
      const { amount: enteredAmount, ...entryValues } = values;
      const created = await api.post<{ usageEntry: { id: number } }>(`/contracts/${id}/usage-entries`, { ...entryValues, quantity: String(entryValues.quantity), ...(amountStreamIds.has(entryValues.pricingStreamId) ? { amountFen: Math.round((enteredAmount ?? 0) * 100) } : {}) });
      if (newPhoto) {
        // The reading is saved either way; a photo that fails to upload can be added again from the list.
        try {
          await uploadMeterPhoto(created.usageEntry.id, newPhoto);
        } catch (err) {
          message.warning(apiErrorMessage(err, t));
        }
      }
      setUsageEntryModal(false);
      setNewPhoto(null);
      usageEntryForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditUsageEntry = async () => {
    if (!editUsageEntryModal) return;
    try {
      const values = await editUsageEntryForm.validateFields();
      const { amount: editedAmount, ...editValues } = values;
      await api.patch(`/usage-entries/${editUsageEntryModal.id}`, { ...editValues, quantity: String(editValues.quantity), ...(amountStreamIds.has(editUsageEntryModal.pricingStreamId) ? { amountFen: Math.round((editedAmount ?? 0) * 100) } : {}) });
      if (editPhoto) {
        try {
          await uploadMeterPhoto(editUsageEntryModal.id, editPhoto);
        } catch (err) {
          message.warning(apiErrorMessage(err, t));
        }
      }
      setEditUsageEntryModal(null);
      setEditPhoto(null);
      editUsageEntryForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditReceipt = async () => {
    if (!editReceiptModal) return;
    try {
      const v = await editReceiptForm.validateFields();
      await api.patch(`/receipts/${editReceiptModal.id}`, {
        receivedDate: v.receivedDate,
        amountFen: Math.round(v.amount * 100),
        paymentMethod: v.paymentMethod,
        externalReference: v.externalReference?.trim() || null,
      });
      setEditReceiptModal(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditDepositTxn = async () => {
    if (!editDepositTxnModal) return;
    try {
      const v = await editDepositTxnForm.validateFields();
      await api.patch(`/deposit-transactions/${editDepositTxnModal.id}`, { transactionDate: v.transactionDate, amountFen: Math.round(v.amount * 100), reason: v.reason });
      setEditDepositTxnModal(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteUsageEntry = async (usageEntryId: number) => {
    try {
      await api.delete(`/usage-entries/${usageEntryId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  // Takes back an entry made by mistake during its correction window (no reason needed).
  const onRemoveEntry = async (path: string) => {
    try {
      await api.post(path, {});
      message.success(t("contracts.entryRemoved"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditConcession = async () => {
    if (!editConcessionModal) return;
    try {
      const values = await editConcessionForm.validateFields();
      await api.patch(`/contracts/${id}/concessions/${editConcessionModal.id}`, { ...values, discountPercentage: String(values.discountPercentage) });
      setEditConcessionModal(null);
      editConcessionForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteConcession = async (concessionId: number) => {
    try {
      await api.delete(`/contracts/${id}/concessions/${concessionId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onEditDepositTerms = async () => {
    if (!editDepositModal) return;
    try {
      const { depositAmountYuan, ...values } = await editDepositForm.validateFields();
      await api.patch(`/contracts/${id}/deposit-terms/${editDepositModal.id}`, {
        ...values,
        fixedAmountFen: depositAmountYuan !== undefined ? Math.round(depositAmountYuan * 100) : undefined,
      });
      setEditDepositModal(null);
      editDepositForm.resetFields();
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteDepositTerms = async (depositTermId: number) => {
    try {
      await api.delete(`/contracts/${id}/deposit-terms/${depositTermId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onGenerate = async () => {
    try {
      const values = await generateForm.validateFields();
      const result = await api.post<{ created: number; skippedExisting: number }>(`/contracts/${id}/generate-charges`, values);
      message.success(t("contracts.generateResult", { created: result.created, skipped: result.skippedExisting }));
      setGenerateModal(false);
      generateForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onPauseAutoBilling = async () => {
    try {
      await api.post(`/contracts/${id}/billing/pause`);
      message.success(t("billing.auto.paused"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onVoidCharge = async () => {
    if (!voidModal) return;
    try {
      const values = await voidForm.validateFields();
      await api.post(`/charges/${voidModal.chargeId}/void`, values);
      message.success(t("billing.void.done"));
      setVoidModal(null);
      voidForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onActivate = async () => {
    try {
      await api.post(`/contracts/${id}/activate`);
      message.success(t("contracts.activate"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onToggleArchived = async () => {
    try {
      await api.post(`/contracts/${id}/${contract.archived ? "unarchive" : "archive"}`);
      message.success(contract.archived ? t("common.unarchived") : t("common.archived"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onUploadDocument = async () => {
    if (!pendingFile || uploadingDoc) return;
    setUploadingDoc(true);
    try {
      const values = await docForm.validateFields();
      const formData = new FormData();
      formData.append("file", pendingFile);
      formData.append("ownerType", "contract");
      formData.append("ownerId", id!);
      formData.append("docType", values.docType);
      if (values.name?.trim()) formData.append("name", values.name.trim());
      formData.append("classification", values.classification);
      await api.post("/documents", formData);
      setDocModal(false);
      docForm.resetFields();
      setPendingFile(null);
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setUploadingDoc(false);
    }
  };

  const downloadDocument = async (docId: number) => {
    const res = await fetch(`/api/documents/${docId}/download`, { credentials: "include" });
    if (!res.ok) {
      message.error(t("common.error"));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const onEditDocument = async () => {
    if (!editDocModal) return;
    try {
      const values = await editDocForm.validateFields();
      await api.patch(`/documents/${editDocModal.id}`, values);
      setEditDocModal(null);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const deleteDocument = async (docId: number) => {
    try {
      await api.delete(`/documents/${docId}`);
      message.success(t("common.deleted"));
      load();
    } catch (err) {
      message.error(apiErrorMessage(err, t));
    }
  };

  const onEditContract = async () => {
    try {
      const { dueDay, dueMonthOffset, overdueGraceDays, ...contractValues } = await editForm.validateFields();
      await Promise.all([
        api.patch(`/contracts/${id}`, contractValues),
        api.patch(`/contracts/${id}/billing-rules`, { dueDay, dueMonthOffset, overdueGraceDays }),
      ]);
      setEditModal(false);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onSaveLatePenalty = async () => {
    try {
      const values = await latePenaltyForm.validateFields();
      await api.patch(`/contracts/${id}/late-penalty-rules`, {
        ...values,
        latePenaltyDailyRatePermille: values.latePenaltyDailyRatePermille !== undefined ? String(values.latePenaltyDailyRatePermille) : undefined,
        latePenaltyCapFen: values.latePenaltyCapFen !== undefined ? Math.round(values.latePenaltyCapFen * 100) : undefined,
      });
      setLatePenaltyModal(false);
      message.success(t("common.save"));
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onDeleteContract = () => {
    Modal.confirm({
      title: t("contracts.deleteContract"),
      content: t("contracts.deleteContractConfirm"),
      okText: t("common.confirm"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await api.delete(`/contracts/${id}`);
          message.success(t("contracts.deleteContract"));
          window.location.href = "/contracts";
        } catch (err) {
          handleError(err);
        }
      },
    });
  };

  const onProposeAmendment = async () => {
    try {
      const values = await amendmentForm.validateFields();
      let changes: Record<string, unknown> = {};
      if (amendmentKind === "rate_change" && values.newAmountOrRate) {
        // The rate in force on the effective date is the one this change replaces (until its own end date).
        const currentRate = rates.find((r) => r.pricingStreamId === values.pricingStreamId && r.effectiveStart <= values.effectiveDate && (!r.effectiveEnd || r.effectiveEnd >= values.effectiveDate));
        changes = {
          addRateSchedule: [
            {
              pricingStreamId: values.pricingStreamId,
              closePreviousRateScheduleId: currentRate?.id,
              effectiveStart: values.effectiveDate,
              calculationMethod: currentRate?.calculationMethod ?? "flat",
              amountOrRate: String(values.newAmountOrRate),
              rateBasis: currentRate?.rateBasis ?? "per_month",
              unit: isMeteredMethod(currentRate?.calculationMethod) ? values.amendRateUnit : undefined,
              linkedStreamId: currentRate?.linkedStreamId ?? undefined,
            },
          ],
        };
      } else if (amendmentKind === "add_unit") {
        changes = {
          addUnits: [
            {
              unitId: values.amendUnitId,
              effectiveStart: values.effectiveDate,
              contractedAreaSqm: String(values.amendContractedAreaSqm),
            },
          ],
        };
      } else if (amendmentKind === "add_pricing_stream") {
        changes = {
          addPricingStreams: [
            {
              feeType: values.amendStreamFeeType,
              targetType: values.amendStreamTargetType,
              label: values.amendStreamLabel || undefined,
              contractUnitIds: values.amendStreamTargetType === "unit" ? values.amendStreamContractUnitIds ?? [] : [],
              initialRate: {
                effectiveStart: values.effectiveDate,
                calculationMethod: values.amendStreamCalculationMethod,
                amountOrRate: values.amendStreamCalculationMethod === "metered_amount" ? "0" : String(values.amendStreamAmountOrRate),
                rateBasis: isUsageFee(values.amendStreamCalculationMethod) ? usageFeeBasis(values.amendStreamCalculationMethod) : values.amendStreamRateBasis,
                unit: isMeteredMethod(values.amendStreamCalculationMethod) ? values.amendStreamUnit : undefined,
                linkedStreamId: isUsageFee(values.amendStreamCalculationMethod) ? values.amendStreamLinkedStreamId : undefined,
              },
            },
          ],
        };
      } else if (amendmentKind === "terminate") {
        changes = {
          contract: { status: "terminated", termEnd: values.effectiveDate },
          endUnits: units.filter((u) => !u.effectiveEnd || u.effectiveEnd > values.effectiveDate).map((u) => ({ contractUnitId: u.id, effectiveEnd: values.effectiveDate })),
        };
      }
      if (amendmentKind === "void_document") changes = { voidDocuments: values.voidDocumentIds };
      if (amendmentKind === "billing_rules") {
        changes = {
          billingRules: { dueDay: values.amendDueDay, dueMonthOffset: values.amendDueMonthOffset, overdueGraceDays: values.amendGraceDays },
          latePenaltyRules: {
            latePenaltyEnabled: !!values.amendLateEnabled,
            ...(values.amendLateEnabled && values.amendLateRate !== undefined ? { latePenaltyDailyRatePermille: String(values.amendLateRate) } : {}),
            ...(values.amendLateEnabled && values.amendLateCap !== undefined && values.amendLateCap !== null ? { latePenaltyCapFen: Math.round(values.amendLateCap * 100) } : {}),
          },
        };
      }
      await api.post(`/contracts/${id}/amendments`, {
        // An internal correction needs no signed supplement; otherwise the type is the kind of change.
        type: values.internalCorrection ? "internal_correction" : amendmentKind,
        reason: values.reason,
        effectiveDate: values.effectiveDate,
        changes,
        supportingDocumentId: values.supportingDocumentId || undefined,
      });
      setAmendmentModal(false);
      amendmentForm.resetFields();
      setAmendmentKind("rate_change");
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onRecordReceipt = async () => {
    try {
      const values = await receiptForm.validateFields();
      await api.post(`/contracts/${id}/receipts`, { ...values, amountFen: Math.round(values.amountFen * 100) });
      setReceiptModal(false);
      receiptForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onAllocate = async () => {
    if (!allocateModal) return;
    try {
      const values = await allocateForm.validateFields();
      await api.post(`/receipts/${allocateModal.receiptId}/allocate`, { chargeId: values.chargeId, amountFen: Math.round(values.amountFen * 100) });
      setAllocateModal(null);
      allocateForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onReverseReceipt = async () => {
    if (!reverseReceiptModal) return;
    try {
      const values = await reverseReceiptForm.validateFields();
      await api.post(`/receipts/${reverseReceiptModal.receiptId}/reverse`, values);
      setReverseReceiptModal(null);
      reverseReceiptForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const onRecordDepositTxn = async () => {
    try {
      const values = await depositTxnForm.validateFields();
      await api.post(`/contracts/${id}/deposit-transactions`, { ...values, amountFen: Math.round(values.amountFen * 100) });
      setDepositTxnModal(false);
      depositTxnForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const supportingDocOptions = documents.map((d) => ({ value: d.id, label: `${docDisplayName(t, d)}${d.name?.trim() ? ` · ${docTypeLabel(t, d.docType)}` : ""} (${d.uploadedAt.slice(0, 10)})` }));
  const needsDocument = (a: AmendmentDto) => a.type !== "internal_correction" && !a.supportingDocumentId;

  const onSaveAmendment = async () => {
    if (!editAmendment) return;
    try {
      const values = await editAmendmentForm.validateFields();
      await api.patch(`/amendments/${editAmendment.id}`, {
        reason: values.reason,
        internalCorrection: !!values.internalCorrection,
        supportingDocumentId: values.supportingDocumentId ?? null,
      });
      setEditAmendment(null);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const submitAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/submit`);
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const approveAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/approve`);
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const withdrawAmendment = async (amendmentId: number) => {
    try {
      await api.post(`/amendments/${amendmentId}/withdraw`);
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const onRejectAmendment = async () => {
    if (!rejectAmendmentModal) return;
    try {
      const values = await rejectAmendmentForm.validateFields();
      await api.post(`/amendments/${rejectAmendmentModal.amendmentId}/reject`, values);
      setRejectAmendmentModal(null);
      rejectAmendmentForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };
  const onReverseDepositTxn = async () => {
    if (!reverseDepositTxnModal) return;
    try {
      const values = await reverseDepositTxnForm.validateFields();
      await api.post(`/deposit-transactions/${reverseDepositTxnModal.depositTxnId}/reverse`, values);
      setReverseDepositTxnModal(null);
      reverseDepositTxnForm.resetFields();
      load();
    } catch (err) {
      handleError(err);
    }
  };

  // Same balance rules as the Dashboard and Reminders, from the ledger already on this page.
  const overdueBalances = chargeBalances.filter((b) => b.isOverdue && b.balanceFen > 0);
  const overdue =
    contract.status === "active" && overdueBalances.length > 0
      ? {
          count: overdueBalances.length,
          fen: overdueBalances.reduce((sum, b) => sum + b.balanceFen, 0),
          days: Math.max(...overdueBalances.map((b) => b.daysOverdue)),
        }
      : null;

  return (
    <div>
      <Space wrap style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
        <Typography.Title level={4} style={{ margin: 0, flexShrink: 0 }}>
          {contract.referenceNumber}
        </Typography.Title>
        <Space wrap>
          <Tag>{t(`contracts.${contract.status}`)}</Tag>
          {contract.archived && <Tag>{t("common.archived")}</Tag>}
          <Tag>v{contract.versionNumber}</Tag>
          {overdue && (
            <Tooltip title={t("billing.overdueTip", { count: overdue.count, amount: yuan(overdue.fen), days: overdue.days })}>
              <Tag color="red" style={{ cursor: "pointer" }} onClick={() => setActiveTab("charges")}>
                {t("billing.overdueTag", { amount: yuan(overdue.fen), days: overdue.days })}
              </Tag>
            </Tooltip>
          )}
          {contract.status === "active" && depositStatus?.state === "short" && (
            <Tag color="orange" style={{ cursor: "pointer" }} onClick={() => setActiveTab("deposit")}>
              {t("billing.deposit.shortTag", { amount: yuan(depositStatus.shortfallFen) })}
            </Tag>
          )}
          {contract.status === "active" && depositStatus?.state === "manual" && (
            <Tag color="orange" style={{ cursor: "pointer" }} onClick={() => setActiveTab("deposit")}>
              {t("billing.deposit.manualTag")}
            </Tag>
          )}
          {(user?.canDownloadPdf || user?.role === "admin" || user?.role === "manager") && (
            <Button icon={<FilePdfOutlined />} onClick={() => window.open(`/api/contracts/${id}/pdf-summary?lang=${exportLang}`, "_blank")}>
              {t("contracts.exportPdf")}
            </Button>
          )}
          {(user?.canPrint || user?.role === "admin" || user?.role === "manager") && (
            <Button icon={<DownloadOutlined />} onClick={() => window.open(`/api/contracts/${id}/ledger.csv?lang=${exportLang}`, "_blank")}>
              {t("contracts.exportCsv")}
            </Button>
          )}
          {user?.role === "admin" &&
            (() => {
              const ended = contract.status === "expired" || contract.status === "terminated";
              const locked = !contract.archived && !ended;
              return (
                <Tooltip title={locked ? t("contracts.archiveOnlyEnded") : undefined}>
                  <span>
                    <Button disabled={locked} onClick={onToggleArchived}>
                      {contract.archived ? t("common.unarchive") : t("common.archive")}
                    </Button>
                  </span>
                </Tooltip>
              );
            })()}
          {isDraft && user?.role === "admin" && (
            <Button icon={<ThunderboltOutlined />} onClick={onActivate}>
              {t("contracts.activate")}
            </Button>
          )}
          {canEdit && (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                editForm.setFieldsValue({ ...contract, dueDay: billingRulesInfo?.dueDay, dueMonthOffset: billingRulesInfo?.dueMonthOffset, overdueGraceDays: billingRulesInfo?.overdueGraceDays });
                setEditModal(true);
              }}
            >
              {t("contracts.editContract")}
            </Button>
          )}
          {canEdit && (
            <Button
              icon={<EditOutlined />}
              onClick={() => {
                latePenaltyForm.setFieldsValue({
                  ...billingRulesInfo,
                  latePenaltyCapFen: billingRulesInfo?.latePenaltyCapFen != null ? billingRulesInfo.latePenaltyCapFen / 100 : undefined,
                });
                setLatePenaltyEnabled(billingRulesInfo?.latePenaltyEnabled ?? false);
                setLatePenaltyModal(true);
              }}
            >
              {t("contracts.latePenaltyRules")}
            </Button>
          )}
          {isDraft && user?.role === "admin" && (
            <Button danger icon={<DeleteOutlined />} onClick={onDeleteContract}>
              {t("contracts.deleteContract")}
            </Button>
          )}
        </Space>
      </Space>
      {contract.archived && <Alert type="info" showIcon message={t("contracts.archivedBanner")} style={{ marginBottom: 12 }} />}
      {isDraft &&
        (documents.some((d) => d.docType === "signed_lease") ? (
          <Alert type="success" showIcon message={t("contracts.activateReady")} style={{ marginBottom: 12 }} />
        ) : documents.length > 0 ? (
          <Alert type="warning" showIcon message={t("contracts.activateWrongType")} style={{ marginBottom: 12 }} />
        ) : (
          <Alert type="info" showIcon message={t("contracts.activateHint")} style={{ marginBottom: 12 }} />
        ))}
      {!isDraft && <Alert type="info" showIcon message={t("contracts.documentRequired")} style={{ marginBottom: 12 }} />}

      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label={t("contracts.landlord")}>
          <Link to={`/landlords?highlight=${contract.landlordPartyId}`}>{partyName(contract.landlordPartyId)}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={t("contracts.tenant")}>
          <Link to={`/tenants?highlight=${contract.tenantPartyId}`}>{partyName(contract.tenantPartyId)}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={t("contracts.termStart")}>{contract.termStart}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.termEnd")}>{contract.termEnd}</Descriptions.Item>
      </Descriptions>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "units",
            label: t("contracts.units"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setUnitModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addUnit")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={units}
                  renderItem={(u) => {
                    const au = availableUnits.find((x) => x.id === u.unitId);
                    return (
                      <List.Item
                        actions={
                          canEdit
                            ? [
                                <Button
                                  key="edit"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editUnitForm.setFieldsValue(u);
                                    setEditUnitModal(u);
                                  }}
                                />,
                                <Popconfirm
                                  key="delete"
                                  title={t("contracts.confirmDeleteUnit")}
                                  onConfirm={() => onDeleteContractUnit(u.id)}
                                  okText={t("common.delete")}
                                  cancelText={t("common.cancel")}
                                >
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>,
                              ]
                            : []
                        }
                      >
                        {au ? <Link to={`/properties/${au.propertyId}`}>{au.unitLabel}</Link> : u.unitId} · {u.contractedAreaSqm} {t("common.sqm")} ·{" "}
                        {u.effectiveStart}
                        {u.effectiveEnd ? ` → ${u.effectiveEnd}` : ""}
                      </List.Item>
                    );
                  }}
                />
              </>
            ),
          },
          {
            key: "pricing",
            label: t("contracts.pricingStreams"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setStreamModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addPricingStream")}
                  </Button>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={streams}
                  pagination={false}
                  columns={[
                    { title: t("contracts.feeType"), dataIndex: "feeType", render: (v: string) => t(`contracts.${camel(v)}`) },
                    { title: t("common.name"), dataIndex: "label" },
                    {
                      title: t("contracts.calculationMethod"),
                      key: "method",
                      render: (_: unknown, s: PricingStreamDto) => {
                        const active = rates.filter((r) => r.pricingStreamId === s.id);
                        return (
                          <>
                            {active.map((r) => (
                              <div key={r.id}>
                                {t(`contracts.${camel(r.calculationMethod)}`)}{r.calculationMethod === "metered_amount" ? "" : ` — ${r.amountOrRate}`}
                                {r.calculationMethod === "usage_fee_percent" ? "%" : ""} ({t(`contracts.${camel(r.rateBasis)}`)}
                                {r.unit ? ` / ${r.unit}` : ""}
                                {isUsageFee(r.calculationMethod)
                                  ? ` · ${t("contracts.linkedStream")}: ${streams.find((x) => x.id === r.linkedStreamId)?.label ?? (r.linkedStreamId ? "#" + r.linkedStreamId : t("contracts.notLinked"))}`
                                  : ""}) [{r.effectiveStart}
                                {r.effectiveEnd ? ` → ${r.effectiveEnd}` : ""}]
                                {canEdit && (
                                  <>
                                    {" "}
                                    <Button
                                      type="link"
                                      size="small"
                                      icon={<EditOutlined />}
                                      onClick={() => {
                                        rateForm.setFieldsValue(r);
                                        setRateModal({ streamId: s.id, rate: r });
                                      }}
                                    />
                                    <Popconfirm
                                      title={t("contracts.confirmDeleteRateTier")}
                                      onConfirm={() => onDeleteRate(s.id, r.id)}
                                      okText={t("common.delete")}
                                      cancelText={t("common.cancel")}
                                    >
                                      <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                  </>
                                )}
                              </div>
                            ))}
                            {canEdit && (
                              <Button
                                type="link"
                                size="small"
                                icon={<PlusOutlined />}
                                onClick={() => setRateModal({ streamId: s.id })}
                              >
                                {t("contracts.addRateTier")}
                              </Button>
                            )}
                          </>
                        );
                      },
                    },
                    ...(canEdit
                      ? [
                          {
                            title: t("common.actions"),
                            key: "actions",
                            render: (_: unknown, s: PricingStreamDto) => (
                              <Space>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editStreamForm.setFieldsValue({
                                      ...s,
                                      contractUnitIds: streamUnitLinks.filter((l) => l.pricingStreamId === s.id).map((l) => l.contractUnitId),
                                    });
                                    setEditStreamModal(s);
                                  }}
                                />
                                <Popconfirm
                                  title={t("contracts.confirmDeleteStream")}
                                  onConfirm={() => onDeleteStream(s.id)}
                                  okText={t("common.delete")}
                                  cancelText={t("common.cancel")}
                                >
                                  <Button size="small" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            ),
          },
          {
            key: "usage",
            label: t("contracts.usageEntries"),
            children: (() => {
              const meteredStreams = streams.filter((s) => rates.some((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod)));
              const streamLabel = (streamId: number) => {
                const s = streams.find((x) => x.id === streamId);
                return s ? s.label ?? t(`contracts.${camel(s.feeType)}`) : streamId;
              };
              const actionsOf = (u: UsageEntryDto) => (
                <Space>
                                  {u.canEdit === false ? (
                                    <Tooltip title={t(`contracts.usageLocked.${u.lockReason ?? "paid"}`)}>
                                      <Button size="small" icon={<LockOutlined />} onClick={() => message.info(t(`contracts.usageLocked.${u.lockReason ?? "paid"}`))} />
                                    </Tooltip>
                                  ) : (
                                    <Tooltip title={u.billed ? t("contracts.editableFor", { time: timeLeft(u.editableUntil) }) : undefined}>
                                      <Button
                                        size="small"
                                        icon={<EditOutlined />}
                                        onClick={() => {
                                          editUsageEntryForm.setFieldsValue({ ...u, amount: u.amountFen != null ? u.amountFen / 100 : undefined });
                                          setEditUsageEntryModal(u);
                                        }}
                                      >
                                        {u.billed ? timeLeft(u.editableUntil) : ""}
                                      </Button>
                                    </Tooltip>
                                  )}
                                  {(!u.billed || u.canEdit) && (
                                    <Popconfirm
                                      title={u.billed ? t("contracts.confirmRemoveBilledReading") : t("contracts.confirmDeleteUsageEntry")}
                                      onConfirm={() => onDeleteUsageEntry(u.id)}
                                      okText={t("common.delete")}
                                      cancelText={t("common.cancel")}
                                    >
                                      <Button size="small" danger icon={<DeleteOutlined />} />
                                    </Popconfirm>
                                  )}
                                </Space>
              );
              const periodOf = (u: UsageEntryDto) => {
                const monthEnd = new Date(Date.UTC(Number(u.serviceStart.slice(0, 4)), Number(u.serviceStart.slice(5, 7)), 0)).toISOString().slice(0, 10);
                return u.serviceStart.endsWith("-01") && u.serviceEnd === monthEnd ? u.serviceStart.slice(0, 7) : `${u.serviceStart} → ${u.serviceEnd}`;
              };
              return (
                <>
                  {canManageUsage && contract.status === "draft" && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.draftActionsNote")} />}
                  {canManageUsage && contract.status !== "draft" && (
                    <Button
                      icon={<PlusOutlined />}
                      disabled={meteredStreams.length === 0}
                      onClick={() => setUsageEntryModal(true)}
                      style={{ marginBottom: 12 }}
                    >
                      {t("contracts.addUsageEntry")}
                    </Button>
                  )}
                  {canManageUsage && contract.status !== "draft" && meteredStreams.length > 0 && (
                    <Button onClick={() => setReadingsGridOpen(true)} style={{ marginBottom: 12, marginLeft: 8 }}>
                      {t("billing.readings.button")}
                    </Button>
                  )}
                  {canManageUsage && contract.status !== "draft" && meteredStreams.length === 0 && (
                    <Typography.Paragraph type="secondary">{t("contracts.usageEntryNoMeteredStreams")}</Typography.Paragraph>
                  )}
                  {isPhone ? (
                    <List
                      bordered
                      dataSource={usageEntries}
                      locale={{ emptyText: t("common.noData", { defaultValue: "No data" }) }}
                      renderItem={(u: UsageEntryDto) => (
                        <List.Item style={{ display: "block" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <Typography.Text strong>
                              {streamLabel(u.pricingStreamId)} · {periodOf(u)}
                            </Typography.Text>
                            <Typography.Text>{`${u.quantity} ${u.unit}${u.amountFen != null ? ` · ${yuan(u.amountFen)}` : ""}`}</Typography.Text>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                            <Typography.Text type="secondary" ellipsis style={{ flex: 1, minWidth: 0 }}>
                              {u.source ?? ""}
                            </Typography.Text>
                            <Space size={4}>
                              <MeterPhotoCell entryId={u.id} documentId={u.photoDocumentId ?? null} missing={!!u.photoMissing} canEdit={canManageUsage && u.canEdit !== false} onChanged={load} />
                              {canManageUsage && actionsOf(u)}
                            </Space>
                          </div>
                        </List.Item>
                      )}
                    />
                  ) : (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={usageEntries}
                    pagination={false}
                    columns={[
                      { title: t("contracts.usageEntryStream"), key: "stream", render: (_: unknown, u: UsageEntryDto) => streamLabel(u.pricingStreamId) },
                      { title: t("contracts.serviceStart"), dataIndex: "serviceStart" },
                      { title: t("contracts.serviceEnd"), dataIndex: "serviceEnd" },
                      { title: t("contracts.usageEntryQuantity"), key: "quantity", render: (_: unknown, u: UsageEntryDto) => `${u.quantity} ${u.unit}${u.amountFen != null ? ` · ${yuan(u.amountFen)}` : ""}` },
                      { title: t("contracts.usageEntrySource"), dataIndex: "source" },
                      {
                        title: t("contracts.photo"),
                        key: "photo",
                        render: (_: unknown, u: UsageEntryDto) => (
                          <MeterPhotoCell entryId={u.id} documentId={u.photoDocumentId ?? null} missing={!!u.photoMissing} canEdit={canManageUsage && u.canEdit !== false} onChanged={load} />
                        ),
                      },
                      ...(canManageUsage
                        ? [
                            {
                              title: t("common.actions"),
                              key: "actions",
                              render: (_: unknown, u: UsageEntryDto) => actionsOf(u),
                            },
                          ]
                        : []),
                    ]}
                  />
                  )}
                </>
              );
            })(),
          },
          {
            key: "concessions",
            label: t("contracts.concessions"),
            children: (
              <>
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setConcessionModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addConcession")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={concessions}
                  renderItem={(c) => (
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Button
                                key="edit"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editConcessionForm.setFieldsValue(c);
                                  setEditConcessionModal(c);
                                }}
                              />,
                              <Popconfirm
                                key="delete"
                                title={t("contracts.confirmDeleteConcession")}
                                onConfirm={() => onDeleteConcession(c.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      {c.discountPercentage}% · {c.effectiveStart} → {c.effectiveEnd} · {c.reason}
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: "deposit",
            label:
              contract.status === "active" && (depositStatus?.state === "short" || depositStatus?.state === "manual") ? (
                <Badge dot color="#d48806" offset={[6, 0]}>
                  {t("contracts.depositTerms")}
                </Badge>
              ) : (
                t("contracts.depositTerms")
              ),
            children: (
              <>
                {contract.status === "draft" && (
                  <Alert style={{ marginBottom: 16 }} type="info" showIcon message={t("billing.deposit.draftNote")} />
                )}
                {contract.status === "active" && depositStatus && depositStatus.state !== "none" && (
                  <div style={{ marginBottom: 16 }}>
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={6}>
                        <Card size="small">
                          <Statistic title={t("billing.deposit.required")} value={yuan(depositStatus.requiredFen)} />
                        </Card>
                      </Col>
                      <Col xs={12} md={6}>
                        <Card size="small">
                          <Statistic title={t("billing.deposit.held")} value={yuan(depositStatus.heldFen)} />
                        </Card>
                      </Col>
                      <Col xs={12} md={6}>
                        <Card size="small">
                          <Statistic
                            title={t("billing.deposit.shortfall")}
                            value={depositStatus.shortfallFen > 0 ? yuan(depositStatus.shortfallFen) : t("billing.deposit.none")}
                            valueStyle={{ color: depositStatus.shortfallFen > 0 ? "#b3423a" : "#2e7d32" }}
                          />
                        </Card>
                      </Col>
                      {depositStatus.waivedFen > 0 && (
                        <Col xs={12} md={6}>
                          <Card size="small">
                            <Statistic title={t("billing.deposit.waived")} value={yuan(depositStatus.waivedFen)} />
                          </Card>
                        </Col>
                      )}
                    </Row>
                    {depositStatus.state === "short" && (
                      <Alert
                        style={{ marginTop: 12 }}
                        type="error"
                        showIcon
                        message={t("billing.deposit.shortTitle", { amount: yuan(depositStatus.shortfallFen) })}
                        description={t("billing.deposit.shortBody")}
                        action={
                          (user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => {
                                setDepositTxnType("receipt");
                                depositTxnForm.setFieldsValue({ transactionType: "receipt" });
                                setDepositTxnModal(true);
                              }}
                            >
                              {t("billing.deposit.recordReceipt")}
                            </Button>
                          )
                        }
                      />
                    )}
                    {depositStatus.state === "manual" && (
                      <Alert style={{ marginTop: 12 }} type="warning" showIcon message={t("billing.deposit.manualTitle")} description={t("billing.deposit.manualBody")} />
                    )}
                  </div>
                )}
                {canEdit && (
                  <Button icon={<PlusOutlined />} onClick={() => setDepositModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.addDepositTerms")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={depositTerms}
                  style={{ marginBottom: 16 }}
                  renderItem={(d) => (
                    <List.Item
                      actions={
                        canEdit
                          ? [
                              <Button
                                key="edit"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editDepositForm.setFieldsValue({
                                    ...d,
                                    depositAmountYuan: d.fixedAmountFen != null ? d.fixedAmountFen / 100 : undefined,
                                  });
                                  setEditDepositModal(d);
                                }}
                              />,
                              <Popconfirm
                                key="delete"
                                title={t("contracts.confirmDeleteDepositTerms")}
                                onConfirm={() => onDeleteDepositTerms(d.id)}
                                okText={t("common.delete")}
                                cancelText={t("common.cancel")}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      {d.requirementType === "fixed" ? yuan(d.fixedAmountFen ?? 0) : `${t("contracts.formula")}: ${d.formulaBasis ?? ""}`} · {t("common.active")}: {d.effectiveStart}
                    </List.Item>
                  )}
                />

                <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 8 }}>
                  <Typography.Text strong>
                    {t("contracts.depositBalance")}: {yuan(depositBalanceFen)}
                  </Typography.Text>
                  {(user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && contract.status !== "draft" && (
                    <Button icon={<PlusOutlined />} onClick={() => setDepositTxnModal(true)}>
                      {t("contracts.recordDepositTxn")}
                    </Button>
                  )}
                </Space>
                {depositTxns.some((x) => x.removedAt) && (
                  <Space size={4} style={{ marginBottom: 12 }}>
                    <Switch size="small" checked={showRemoved} onChange={setShowRemoved} />
                    <Typography.Text type="secondary">{t("contracts.showRemoved")}</Typography.Text>
                  </Space>
                )}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={shownDepositTxns}
                  columns={[
                    { title: t("contracts.transactionDate"), dataIndex: "transactionDate" },
                    { title: t("contracts.transactionType"), dataIndex: "transactionType", render: (v: string) => t(`contracts.depositTxnTypes.${v}`, { defaultValue: v }) },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    { title: t("contracts.reason"), dataIndex: "reason" },
                    {
                      title: t("common.actions"),
                      key: "actions",
                      render: (_: unknown, txn: DepositTransactionDto) => {
                        const reversal = depositTxns.find((t) => t.reversalOfId === txn.id);
                        if (reversal) return reversal.removedAt ? <Tag>{t("contracts.removed")}</Tag> : <Tag color="red">{t("contracts.reversed")}</Tag>;
                        if (txn.transactionType === "reversal") return txn.removedAt ? <Tag>{t("contracts.removed")}</Tag> : null;
                        return (
                          <Space>
                            {txn.canEdit && (
                              <Tooltip title={t("contracts.editableFor", { time: timeLeft(txn.editableUntil) })}>
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => {
                                    editDepositTxnForm.setFieldsValue({ transactionDate: txn.transactionDate, amount: Math.abs(txn.amountFen) / 100, reason: txn.reason });
                                    setEditDepositTxnModal(txn);
                                  }}
                                >
                                  {timeLeft(txn.editableUntil)}
                                </Button>
                              </Tooltip>
                            )}
                            {txn.canEdit && (
                              <Popconfirm title={t("contracts.confirmRemoveDeposit")} okText={t("contracts.removeEntry")} cancelText={t("common.cancel")} onConfirm={() => onRemoveEntry(`/deposit-transactions/${txn.id}/remove`)}>
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            )}
                            {user?.role === "admin" && (
                              <Button size="small" danger onClick={() => setReverseDepositTxnModal({ depositTxnId: txn.id })}>
                                {t("contracts.reverse")}
                              </Button>
                            )}
                          </Space>
                        );
                      },
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: "statement",
            label: t("contracts.statement"),
            children:
              contract.status === "draft" ? (
                <Alert type="info" showIcon message={t("contracts.statementDraftNote")} />
              ) : (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <MonthField value={statementPeriod} onChange={(v) => v && setStatementPeriod(v)} style={{ width: 160 }} />
                </Space>
                {statement && (
                  <Descriptions bordered column={1} size="small">
                    <Descriptions.Item label={t("contracts.openingReceivable")}>{yuan(statement.openingReceivableFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.newCharges")}>{yuan(statement.newChargesFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.adjustments")}>{yuan(statement.adjustmentsFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.receiptsApplied")}>{yuan(statement.receiptsAppliedFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.closingReceivable")}>
                      <Typography.Text strong>{yuan(statement.closingReceivableFen)}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t("contracts.unallocatedReceipts")}>{yuan(statement.unallocatedReceiptsFen)}</Descriptions.Item>
                    <Descriptions.Item label={t("contracts.depositBalance")}>{yuan(statement.depositBalanceFen)}</Descriptions.Item>
                  </Descriptions>
                )}
                {statement && (
                  <div style={{ marginTop: 16 }}>
                    <Typography.Title level={5}>{t("chargeDetail.statementBills")}</Typography.Title>
                    {isPhone ? (
                      <BillRows
                        empty={t("common.noneYet")}
                        rows={charges.filter((c) => c.status === "posted" && c.serviceStart >= statement.periodStart && c.serviceStart <= statement.periodEnd).map((c) => ({
                          key: c.id,
                          name: itemNameOf(c.pricingStreamId, c.feeType),
                          detail: `${t("contracts.dueDate")} ${c.dueDate}`,
                          amountFen: c.amountFen,
                          status: chargeStatusTag(c, chargeBalances.find((x) => x.chargeId === c.id)),
                          onClick: () => setDetailChargeId(c.id),
                        }))}
                      />
                    ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      scroll={{ x: true }}
                      dataSource={charges.filter((c) => c.status === "posted" && c.serviceStart >= statement.periodStart && c.serviceStart <= statement.periodEnd)}
                      onRow={(c: ChargeDto) => ({ onClick: () => setDetailChargeId(c.id), style: { cursor: "pointer" } })}
                      columns={[
                        { title: t("contracts.fee"), render: (_: unknown, c: ChargeDto) => itemNameOf(c.pricingStreamId, c.feeType) },
                        { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                        { title: t("contracts.amount"), dataIndex: "amountFen", align: "right" as const, render: yuan },
                        {
                          title: t("contracts.balance"),
                          align: "right" as const,
                          render: (_: unknown, c: ChargeDto) => {
                            const b = chargeBalances.find((x) => x.chargeId === c.id);
                            return b ? yuan(b.balanceFen) : "";
                          },
                        },
                      ]}
                    />
                    )}
                  </div>
                )}
              </>
              ),
          },
          {
            key: "receipts",
            label: t("contracts.receipts"),
            children: (
              <>
                {(user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && contract.status === "draft" && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.draftActionsNote")} />}
                {(user?.role === "admin" || user?.role === "manager" || user?.role === "collector") && contract.status !== "draft" && (
                  <Space wrap style={{ marginBottom: 12 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setPaymentOpen(true)}>
                      {t("billing.payment.button")}
                    </Button>
                    <Button onClick={() => setBulkPaymentOpen(true)}>{t("billing.bulkPayments.button")}</Button>
                    <Button icon={<PlusOutlined />} onClick={() => setReceiptModal(true)}>
                      {t("contracts.recordReceipt")}
                    </Button>
                  </Space>
                )}
                {receipts.some((r) => r.removedAt) && (
                  <Space size={4} style={{ marginBottom: 12 }}>
                    <Switch size="small" checked={showRemoved} onChange={setShowRemoved} />
                    <Typography.Text type="secondary">{t("contracts.showRemoved")}</Typography.Text>
                  </Space>
                )}
                {isPhone ? (
                  <List
                    bordered
                    size="small"
                    dataSource={shownReceipts}
                    locale={{ emptyText: t("common.noneYet") }}
                    renderItem={(r: ReceiptDto) => {
                      const unallocated = receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0;
                      return (
                        <List.Item style={{ display: "block" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <Typography.Text strong>
                              {r.receivedDate} · {paymentMethodLabel(t, r.paymentMethod)}
                            </Typography.Text>
                            <Typography.Text style={{ whiteSpace: "nowrap" }}>{yuan(r.amountFen)}</Typography.Text>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                            <Space size={4} wrap>
                              {r.removedAt ? <Tag>{t("contracts.removed")}</Tag> : r.status === "reversed" ? <Tag color="red">{t("contracts.reversed")}</Tag> : null}
                              {unallocated > 0 && (
                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                  {t("contracts.unallocated")} {yuan(unallocated)}
                                </Typography.Text>
                              )}
                            </Space>
                            {r.status === "posted" && receiptActions(r)}
                          </div>
                        </List.Item>
                      );
                    }}
                  />
                ) : (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={shownReceipts}
                  columns={[
                    { title: t("contracts.receivedDate"), dataIndex: "receivedDate" },
                    { title: t("contracts.paymentMethod"), dataIndex: "paymentMethod", render: (v: string) => paymentMethodLabel(t, v) },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    {
                      title: t("contracts.unallocated"),
                      key: "unallocated",
                      render: (_: unknown, r: ReceiptDto) => yuan(receiptBalances.find((b) => b.receiptId === r.id)?.unallocatedFen ?? 0),
                    },
                    { title: t("common.actions"), dataIndex: "status", render: (s: string, r: ReceiptDto) => (r.removedAt ? <Tag>{t("contracts.removed")}</Tag> : s === "reversed" ? <Tag color="red">{t("contracts.reversed")}</Tag> : <Tag>{t(`contracts.receiptStatus.${s}`, { defaultValue: s })}</Tag>) },
                    {
                      title: "",
                      key: "action",
                      render: (_: unknown, r: ReceiptDto) =>
                        r.status === "posted" && receiptActions(r),
                    },
                  ]}
                />
                )}
              </>
            ),
          },
          {
            key: "charges",
            label: overdue ? (
              <Tooltip title={t("billing.overdueTip", { count: overdue.count, amount: yuan(overdue.fen), days: overdue.days })}>
                <Badge dot color="#b3423a" offset={[6, 0]}>
                  {t("contracts.charges")}
                </Badge>
              </Tooltip>
            ) : (
              t("contracts.charges")
            ),
            children: (
              <>
                {contract.status === "active" && billingRulesInfo && (
                  billingRulesInfo.billingFrequency !== "monthly" ? (
                    <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("billing.auto.manualOnly")} />
                  ) : billingRulesInfo.autoBilling ? (
                    <Alert
                      type="success"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={t("billing.auto.on")}
                      description={t("billing.auto.onBody", { days: billingRulesInfo.overdueGraceDays })}
                      action={
                        user?.role === "admin" && (
                          <Popconfirm title={t("billing.auto.pauseConfirm")} onConfirm={onPauseAutoBilling} okText={t("billing.auto.pause")} cancelText={t("common.cancel")}>
                            <Button size="small">{t("billing.auto.pause")}</Button>
                          </Popconfirm>
                        )
                      }
                    />
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message={t("billing.auto.off")}
                      description={t(user?.role === "admin" ? "billing.auto.offBodyAdmin" : "billing.auto.offBody")}
                      action={
                        user?.role === "admin" && (
                          <Button size="small" type="primary" onClick={() => setCatchUpOpen(true)}>
                            {t("billing.catchUp.button")}
                          </Button>
                        )
                      }
                    />
                  )
                )}
                {(user?.role === "admin" || user?.role === "manager") && contract.status === "draft" && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.draftActionsNote")} />}
                {user?.role === "admin" && contract.status !== "draft" && <OpeningBalancePanel contractId={contract.id} onChanged={load} />}
                {(user?.role === "admin" || user?.role === "manager") && contract.status !== "draft" && (
                  <Button icon={<PlusOutlined />} onClick={() => setGenerateModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.generateCharges")}
                  </Button>
                )}
                {isPhone ? (
                  <BillRows
                    empty={t("common.noneYet")}
                    rows={charges.map((c) => {
                      const b = chargeBalances.find((x) => x.chargeId === c.id);
                      return {
                        key: c.id,
                        name: (
                          <>
                            {itemNameOf(c.pricingStreamId, c.feeType)}
                            {c.calculationSnapshotJson?.includes('"opening_balance"') && (
                              <Tag color="blue" style={{ marginLeft: 6 }}>
                                {t("openingBalance.broughtForward")}
                              </Tag>
                            )}
                          </>
                        ),
                        period: periodLabel(c.serviceStart, c.serviceEnd),
                        detail: `${t("contracts.dueDate")} ${c.dueDate}`,
                        amountFen: c.amountFen,
                        status: chargeStatusTag(c, b),
                        onClick: () => setDetailChargeId(c.id),
                      };
                    })}
                  />
                ) : (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={charges}
                  onRow={(c: ChargeDto) => ({ onClick: () => setDetailChargeId(c.id), style: { cursor: "pointer" } })}
                  columns={[
                    {
                      title: t("contracts.fee"),
                      render: (_: unknown, c: ChargeDto) => (
                        <Space size={4} wrap>
                          {itemNameOf(c.pricingStreamId, c.feeType)}
                          {c.calculationSnapshotJson?.includes('"opening_balance"') && <Tag color="blue">{t("openingBalance.broughtForward")}</Tag>}
                        </Space>
                      ),
                    },
                    { title: t("chargeDetail.servicePeriod"), render: (_: unknown, c: ChargeDto) => periodLabel(c.serviceStart, c.serviceEnd) },
                    { title: t("contracts.dueDate"), dataIndex: "dueDate" },
                    { title: t("contracts.amount"), dataIndex: "amountFen", render: yuan },
                    {
                      title: t("contracts.balance"),
                      key: "balance",
                      render: (_: unknown, c: ChargeDto) => {
                        const b = chargeBalances.find((x) => x.chargeId === c.id);
                        if (!b) return null;
                        if (c.status === "voided") return chargeStatusTag(c, b);
                        return (
                          <Space>
                            {yuan(b.balanceFen)}
                            {b.isOverdue && <Tag color="red">{t("contracts.overdueDays", { days: b.daysOverdue })}</Tag>}
                          </Space>
                        );
                      },
                    },
                    {
                      title: "",
                      key: "details",
                      width: 90,
                      render: (_: unknown, c: ChargeDto) => (
                        <Space size={0}>
                          {user?.role === "admin" &&
                            (() => {
                              const b = chargeBalances.find((x) => x.chargeId === c.id);
                              // Charges with payments or amendment adjustments can't be voided.
                              if (c.status !== "posted" || !b || b.allocatedFen !== 0 || b.adjustedFen !== 0) return null;
                              return (
                                <Button size="small" danger type="text" onClick={(e) => { e.stopPropagation(); setVoidModal({ chargeId: c.id }); }}>
                                  {t("billing.void.button")}
                                </Button>
                              );
                            })()}
                        </Space>
                      ),
                    },
                  ]}
                />
                )}
              </>
            ),
          },
          {
            key: "upcoming",
            label: t("billing.upcoming.tab"),
            children: <UpcomingBillsTab contractId={Number(id)} reloadKey={charges.length + ":" + chargeBalances.length} />,
          },
          {
            key: "amendments",
            label: t("contracts.amendments"),
            children: (
              <>
                {canPropose && contract.status === "draft" && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.amendmentsDraftNote")} />}
                {canPropose && contract.status !== "draft" && (
                  <Button icon={<PlusOutlined />} onClick={() => setAmendmentModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.proposeAmendment")}
                  </Button>
                )}
                <List
                  bordered
                  dataSource={amendments}
                  renderItem={(a) => (
                    <List.Item
                      actions={[
                        a.status === "draft" && (user?.role === "admin" || (user?.role === "manager" && a.createdBy === user.id)) && (
                          <Button
                            key="edit"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => {
                              editAmendmentForm.setFieldsValue({ reason: a.reason, internalCorrection: a.type === "internal_correction", supportingDocumentId: a.supportingDocumentId ?? undefined });
                              setEditAmendment(a);
                            }}
                          >
                            {t("common.edit")}
                          </Button>
                        ),
                        a.status === "draft" && (
                          <Tooltip key="submit" title={needsDocument(a) ? t("contracts.attachDocumentFirst") : undefined}>
                            <span>
                              <Button size="small" disabled={needsDocument(a)} onClick={() => submitAmendment(a.id)}>
                                {t("contracts.submit")}
                              </Button>
                            </span>
                          </Tooltip>
                        ),
                        a.status === "pending" && user?.role === "admin" && (
                          <Button key="approve" size="small" type="primary" onClick={() => approveAmendment(a.id)}>
                            {t("contracts.approve")}
                          </Button>
                        ),
                        a.status === "pending" && user?.role === "admin" && (
                          <Button key="reject" size="small" danger onClick={() => setRejectAmendmentModal({ amendmentId: a.id })}>
                            {t("contracts.reject")}
                          </Button>
                        ),
                        (a.status === "draft" || a.status === "pending") && (user?.role === "admin" || a.submittedBy === user?.id || a.createdBy === user?.id) && (
                          <Button key="withdraw" size="small" onClick={() => withdrawAmendment(a.id)}>
                            {t("contracts.withdraw")}
                          </Button>
                        ),
                      ].filter(Boolean)}
                    >
                      <Space direction="vertical" size={0}>
                        <span>
                          <Tag>{t(`contracts.amendTypeNames.${a.type}`, { defaultValue: a.type })}</Tag> {a.reason}
                          {a.status === "draft" && needsDocument(a) && <Tag color="orange" style={{ marginLeft: 8 }}>{t("contracts.supportingDocumentMissing")}</Tag>}
                        </span>
                        <Typography.Text type="secondary">
                          {t("contracts.effectiveDate")}: {a.effectiveDate} · {t(`contracts.${a.status}`)}
                          {a.supportingDocumentId && allDocuments.find((d) => d.id === a.supportingDocumentId)
                            ? ` · ${t("contracts.supportingDocument")}: ${docDisplayName(t, allDocuments.find((d) => d.id === a.supportingDocumentId)!)}`
                            : ""}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
          {
            key: "documents",
            label: t("contracts.documents"),
            children: (
              <>
                {(user?.role === "admin" || user?.role === "manager") && (
                  <Button icon={<UploadOutlined />} onClick={() => setDocModal(true)} style={{ marginBottom: 12 }}>
                    {t("contracts.uploadDocument")}
                  </Button>
                )}
                {allDocuments.some((d) => d.voided) && (
                  <Space size={4} style={{ marginBottom: 12, marginLeft: 12 }}>
                    <Switch size="small" checked={showVoidedDocs} onChange={setShowVoidedDocs} />
                    <Typography.Text type="secondary">{t("contracts.showVoidedDocuments")}</Typography.Text>
                  </Space>
                )}
                <List
                  bordered
                  dataSource={showVoidedDocs ? allDocuments : documents}
                  renderItem={(d) => (
                    <List.Item
                      actions={[
                        <Button key="dl" type="link" icon={<DownloadOutlined />} onClick={() => downloadDocument(d.id)}>
                          {t("properties.download")}
                        </Button>,
                        ...(user?.role === "admin" || user?.role === "manager"
                          ? [
                              <Button
                                key="edit"
                                type="link"
                                icon={<EditOutlined />}
                                onClick={() => {
                                  editDocForm.setFieldsValue({ name: d.name ?? undefined, docType: d.docType, classification: d.classification });
                                  setEditDocModal(d);
                                }}
                              />,
                            ]
                          : []),
                        // Deleting is for a draft only (Admin or Manager); afterwards a document is withdrawn by amendment.
                        ...((user?.role === "admin" || user?.role === "manager") && !d.voided
                          ? [
                              isDraft || (d.fileMissing && user?.role === "admin") ? (
                                <Popconfirm
                                  key="del"
                                  title={d.fileMissing ? t("contracts.confirmRemoveBrokenDocument") : t("properties.confirmDeleteDocument")}
                                  onConfirm={() => deleteDocument(d.id)}
                                  okText={t("common.delete")}
                                  cancelText={t("common.cancel")}
                                >
                                  <Button type="link" danger icon={<DeleteOutlined />} />
                                </Popconfirm>
                              ) : (
                                <Tooltip key="del" title={t("contracts.deleteByAmendment")}>
                                  <span>
                                    <Button type="link" danger disabled icon={<DeleteOutlined />} />
                                  </span>
                                </Tooltip>
                              ),
                            ]
                          : []),
                      ]}
                    >
                      <Space direction="vertical" size={0}>
                        <Space wrap>
                          {d.classification === "sensitive" && <LockOutlined />}
                          <Typography.Text delete={d.voided}>{docDisplayName(t, d)}</Typography.Text>
                          {d.name?.trim() && <Tag>{docTypeLabel(t, d.docType)}</Tag>}
                          {d.classification === "sensitive" && <Tag color="orange">{t("properties.sensitive")}</Tag>}
                          {d.voided && <Tag color="red">{t("contracts.documentVoided")}</Tag>}
                          {d.fileMissing && <Tag color="red">{t("contracts.documentFileMissing")}</Tag>}
                        </Space>
                        <Typography.Text type="secondary">
                          {d.uploadedAt.slice(0, 10)}
                          {d.uploadedByName ? ` · ${d.uploadedByName}` : ""}
                        </Typography.Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        title={t("contracts.uploadDocument")}
        open={docModal}
        onCancel={() => setDocModal(false)}
        onOk={onUploadDocument}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        confirmLoading={uploadingDoc}
        okButtonProps={{ disabled: !pendingFile || uploadingDoc }}
        cancelButtonProps={{ disabled: uploadingDoc }}
        closable={!uploadingDoc}
        maskClosable={!uploadingDoc}
      >
        <Form form={docForm} layout="vertical">
          <Form.Item label={t("contracts.file")} required>
            <Upload
              disabled={uploadingDoc}
              beforeUpload={(file) => {
                setPendingFile(file);
                return false;
              }}
              maxCount={1}
              accept="image/*,.pdf"
            >
              <Button icon={<UploadOutlined />}>{t("contracts.selectFile")}</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="name" label={t("contracts.documentName")} extra={t("contracts.documentNameHint")}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="docType" label={t("properties.docType")} rules={[{ required: true }]} initialValue="signed_lease">
            <Select
              options={[
                { value: "signed_lease", label: t("contracts.signedLease") },
                { value: "signed_supplement", label: t("contracts.signedSupplement") },
                { value: "other", label: t("contracts.otherDocumentType") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="classification"
            label={
              <>
                {t("properties.classification")} <HelpIcon field="documentClassification" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="ordinary"
          >
            <Select
              options={[
                { value: "ordinary", label: t("properties.ordinary") },
                { value: "sensitive", label: t("properties.sensitive") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editDocModal}
        onCancel={() => setEditDocModal(null)}
        onOk={onEditDocument}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editDocForm} layout="vertical">
          <Form.Item name="name" label={t("contracts.documentName")} extra={t("contracts.documentNameHint")}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item
            name="docType"
            label={t("properties.docType")}
            rules={[{ required: true }]}
            extra={editDocModal && !isDraft && editDocModal.docType === "signed_lease" ? t("contracts.documentTypeLocked") : undefined}
          >
            <Select
              disabled={!!editDocModal && (editDocModal.voided || (!isDraft && editDocModal.docType === "signed_lease"))}
              options={[
                { value: "signed_lease", label: t("contracts.signedLease") },
                { value: "signed_supplement", label: t("contracts.signedSupplement") },
                { value: "other", label: t("contracts.otherDocumentType") },
              ]}
            />
          </Form.Item>
          <Form.Item name="classification" label={t("properties.classification")} rules={[{ required: true }]} extra={user?.role !== "admin" ? t("contracts.classificationAdminOnly") : undefined}>
            <Select
              disabled={user?.role !== "admin"}
              options={[
                { value: "ordinary", label: t("properties.ordinary") },
                { value: "sensitive", label: t("properties.sensitive") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.editContract")}
        open={editModal}
        onCancel={() => setEditModal(false)}
        onOk={onEditContract}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="referenceNumber" label={t("contracts.reference")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="landlordPartyId" label={t("contracts.landlord")} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="tenantPartyId" label={t("contracts.tenant")} rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={parties.map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="termStart" label={t("contracts.termStart")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="termEnd" label={t("contracts.termEnd")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="renewalNoticeDays" label={t("contracts.renewalNoticeDays")}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="dueDay" label={t("contracts.dueDay")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={1} max={31} />
          </Form.Item>
          <Form.Item
            name="dueMonthOffset"
            label={
              <>
                {t("contracts.dueMonthOffset")} <HelpIcon field="dueMonthOffset" />
              </>
            }
          >
            <InputNumber style={{ width: "100%" }} min={-3} max={3} />
          </Form.Item>
          <Form.Item name="overdueGraceDays" label={t("billing.graceDays")} extra={t("billing.graceDaysHint")}>
            <InputNumber style={{ width: "100%" }} min={0} max={60} />
          </Form.Item>
          <Form.Item name="specialTerms" label={t("contracts.specialTerms")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.latePenaltyRules")}
        open={latePenaltyModal}
        onCancel={() => setLatePenaltyModal(false)}
        onOk={onSaveLatePenalty}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form
          form={latePenaltyForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.latePenaltyEnabled !== undefined) setLatePenaltyEnabled(v.latePenaltyEnabled);
          }}
        >
          <Form.Item name="latePenaltyEnabled" label={t("contracts.latePenaltyEnabled")} valuePropName="checked">
            <Switch />
          </Form.Item>
          {(latePenaltyEnabled || billingRulesInfo?.latePenaltyEnabled) && (
            <>
              <Form.Item name="latePenaltyDailyRatePermille" label={t("contracts.latePenaltyDailyRate")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} step={0.1} />
              </Form.Item>
              <Form.Item name="latePenaltyCapFen" label={t("contracts.latePenaltyCap")}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Modal title={t("contracts.addUnit")} open={unitModal} onCancel={() => setUnitModal(false)} onOk={onAddUnit} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form
          form={unitForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.unitId !== undefined && areaOfUnit(v.unitId)) unitForm.setFieldsValue({ contractedAreaSqm: areaOfUnit(v.unitId) });
          }}
        >
          <Form.Item name="unitId" label={t("properties.unitLabel")} rules={[{ required: true }]}>
            <Select options={availableUnits.map((u) => ({ value: u.id, label: u.unitLabel }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="contractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editUnitModal}
        onCancel={() => setEditUnitModal(null)}
        onOk={onEditContractUnit}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editUnitForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.termEnd")}>
            <DateField />
          </Form.Item>
          <Form.Item name="contractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="notes" label={t("contracts.reason")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addPricingStream")} open={streamModal} onCancel={() => setStreamModal(false)} onOk={onAddStream} okText={t("common.create")} cancelText={t("common.cancel")} width={560}>
        <Form
          form={streamForm}
          layout="vertical"
          onValuesChange={(v) => {
            const names = ["rent", "management", "electricity_base", "water", "elevator", "other"].map(feeName);
            if (v.feeType) {
              const current = streamForm.getFieldValue("label");
              if (!current || names.includes(current)) streamForm.setFieldsValue({ label: feeName(v.feeType) });
            }
            if (isUsageFee(v.calculationMethod)) {
              streamForm.setFieldsValue({ rateBasis: usageFeeBasis(v.calculationMethod) });
              if (meteredStreamOptions.length === 1) streamForm.setFieldsValue({ linkedStreamId: meteredStreamOptions[0].value });
            }
            if (isMeteredMethod(v.calculationMethod)) {
              streamForm.setFieldsValue({ rateBasis: "per_unit" });
              const unit = defaultMeterUnit(streamForm.getFieldValue("feeType"), i18n.language);
              const cur = streamForm.getFieldValue("unit");
              if (unit && (!cur || AUTO_UNITS.includes(cur))) streamForm.setFieldsValue({ unit });
            }
          }}
        >
          <Form.Item name="feeType" label={t("contracts.feeType")} rules={[{ required: true }]} initialValue="rent">
            <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
          </Form.Item>
          <Form.Item name="targetType" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="unit" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="label" label={t("common.name")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="contractUnitIds"
            label={
              <>
                {t("contracts.units")} <HelpIcon field="pricingTargetUnits" />
              </>
            }
            rules={[{ required: true }]}
          >
            <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
          </Form.Item>
          <Form.Item
            name="calculationMethod"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="calculationMethod" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="flat"
          >
            <Select options={methodOptions} />
          </Form.Item>
          {isUsageFee(streamMethod) && linkedStreamField("linkedStreamId")}
          <Form.Item
            name="rateBasis"
            label={
              <>
                {t("contracts.rateBasis")} <HelpIcon field="rateBasis" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="per_month"
          >
            <Select disabled={isUsageFee(streamMethod)} options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
          </Form.Item>
          <Form.Item name="amountOrRate" label={t("contracts.amountOrRate")} hidden={streamMethod === "metered_amount"} rules={[{ required: streamMethod !== "metered_amount" }]} extra={usageFeeValueExtra(streamMethod)}>
            <InputNumber style={{ width: "100%" }} min={0} max={streamMethod === "usage_fee_percent" ? 100 : undefined} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.calculationMethod !== cur.calculationMethod}>
            {() =>
              isMeteredMethod(streamForm.getFieldValue("calculationMethod")) && (
                <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
                  <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editStreamModal}
        onCancel={() => setEditStreamModal(null)}
        onOk={onEditStream}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
        width={560}
      >
        <Form form={editStreamForm} layout="vertical">
          <Form.Item name="feeType" label={t("contracts.feeType")} rules={[{ required: true }]}>
            <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
          </Form.Item>
          <Form.Item name="label" label={t("common.name")}>
            <Input />
          </Form.Item>
          <Form.Item
            name="contractUnitIds"
            label={
              <>
                {t("contracts.units")} <HelpIcon field="pricingTargetUnits" />
              </>
            }
          >
            <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={rateModal?.rate ? t("common.edit") : t("contracts.addRateTier")}
        open={!!rateModal}
        onCancel={() => setRateModal(null)}
        onOk={onSaveRate}
        okText={rateModal?.rate ? t("common.save") : t("common.create")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form
          form={rateForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (isUsageFee(v.calculationMethod)) {
              rateForm.setFieldsValue({ rateBasis: usageFeeBasis(v.calculationMethod) });
              if (!rateForm.getFieldValue("linkedStreamId") && meteredStreamOptions.length === 1) rateForm.setFieldsValue({ linkedStreamId: meteredStreamOptions[0].value });
            }
            if (isMeteredMethod(v.calculationMethod) && !rateModal?.rate) {
              rateForm.setFieldsValue({ rateBasis: "per_unit" });
              const stream = streams.find((st) => st.id === rateModal?.streamId);
              const unit = defaultMeterUnit(stream?.feeType, i18n.language);
              const cur = rateForm.getFieldValue("unit");
              if (unit && (!cur || AUTO_UNITS.includes(cur))) rateForm.setFieldsValue({ unit });
            }
          }}
        >
          <Form.Item
            name="calculationMethod"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="calculationMethod" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="flat"
          >
            <Select options={methodOptions} />
          </Form.Item>
          {isUsageFee(rateMethod) && linkedStreamField("linkedStreamId")}
          <Form.Item
            name="rateBasis"
            label={
              <>
                {t("contracts.rateBasis")} <HelpIcon field="rateBasis" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="per_month"
          >
            <Select disabled={isUsageFee(rateMethod)} options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
          </Form.Item>
          <Form.Item name="amountOrRate" label={t("contracts.amountOrRate")} hidden={rateMethod === "metered_amount"} rules={[{ required: rateMethod !== "metered_amount" }]} extra={usageFeeValueExtra(rateMethod)}>
            <InputNumber style={{ width: "100%" }} min={0} max={rateMethod === "usage_fee_percent" ? 100 : undefined} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.calculationMethod !== cur.calculationMethod}>
            {() =>
              isMeteredMethod(rateForm.getFieldValue("calculationMethod")) && (
                <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
                  <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.termEnd")}>
            <DateField />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.addUsageEntry")}
        open={usageEntryModal}
        onCancel={() => {
          setUsageEntryModal(false);
          setNewPhoto(null);
        }}
        onOk={onAddUsageEntry}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form
          form={usageEntryForm}
          layout="vertical"
          onValuesChange={(changed) => {
            // Picking a stream prefills the usual unit (kWh / m³), but never overwrites one the user typed.
            if (changed.pricingStreamId === undefined) return;
            const stream = streams.find((s) => s.id === changed.pricingStreamId);
            const suggested = defaultMeterUnit(stream?.feeType, i18n.language);
            const current = usageEntryForm.getFieldValue("unit");
            if (suggested && (!current || AUTO_UNITS.includes(current))) usageEntryForm.setFieldsValue({ unit: suggested });
          }}
        >
          <Form.Item name="pricingStreamId" label={t("contracts.usageEntryStream")} rules={[{ required: true }]}>
            <Select
              options={streams
                .filter((s) => rates.some((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod)))
                .map((s) => ({ value: s.id, label: s.label ?? t(`contracts.${camel(s.feeType)}`) }))}
            />
          </Form.Item>
          <MonthShortcuts form={usageEntryForm} />
          <Form.Item name="serviceStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="serviceEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="quantity" label={t("contracts.usageEntryQuantity")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          {newUsageStreamId !== undefined && amountStreamIds.has(newUsageStreamId) && (
            <>
              <Form.Item name="amount" label={t("contracts.usageEntryAmount")} rules={[{ required: true }]} extra={t("contracts.usageEntryAmountHint")}>
                <InputNumber style={{ width: "100%" }} min={0} precision={2} prefix="¥" />
              </Form.Item>
              {priceHint(newUsageStreamId, usageEntryForm.getFieldValue("serviceStart"), newUsageQuantity, newUsageAmount, usageEntryForm.getFieldValue("unit") ?? "")}
            </>
          )}
          <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
            <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
          </Form.Item>
          <Form.Item name="source" label={t("contracts.usageEntrySource")}>
            <Input />
          </Form.Item>
          <Form.Item label={t("contracts.photoOptional")}>
            <PhotoPicker value={newPhoto} onChange={setNewPhoto} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editUsageEntryModal}
        onCancel={() => {
          setEditUsageEntryModal(null);
          setEditPhoto(null);
        }}
        onOk={onEditUsageEntry}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editUsageEntryForm} layout="vertical">
          {editUsageEntryModal?.billed && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t("contracts.usageBilledEditHint", { time: timeLeft(editUsageEntryModal.editableUntil) })} />}
          {!editUsageEntryModal?.billed && <MonthShortcuts form={editUsageEntryForm} />}
          <Form.Item name="serviceStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <DateField disabled={!!editUsageEntryModal?.billed} />
          </Form.Item>
          <Form.Item name="serviceEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <DateField disabled={!!editUsageEntryModal?.billed} />
          </Form.Item>
          <Form.Item name="quantity" label={t("contracts.usageEntryQuantity")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          {editUsageEntryModal && amountStreamIds.has(editUsageEntryModal.pricingStreamId) && (
            <>
              <Form.Item name="amount" label={t("contracts.usageEntryAmount")} rules={[{ required: true }]} extra={t("contracts.usageEntryAmountHint")}>
                <InputNumber style={{ width: "100%" }} min={0} precision={2} prefix="¥" />
              </Form.Item>
              {priceHint(editUsageEntryModal.pricingStreamId, editUsageEntryModal.serviceStart, editUsageQuantity, editUsageAmount, editUsageEntryModal.unit)}
            </>
          )}
          <Form.Item name="unit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
            <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
          </Form.Item>
          <Form.Item name="source" label={t("contracts.usageEntrySource")}>
            <Input />
          </Form.Item>
          <Form.Item label={t("contracts.photoOptional")}>
            <PhotoPicker value={editPhoto} onChange={setEditPhoto} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addConcession")} open={concessionModal} onCancel={() => setConcessionModal(false)} onOk={onAddConcession} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={concessionForm} layout="vertical">
          <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
            <Select allowClear placeholder={t("contracts.allStreams")} options={streams.map((s) => ({ value: s.id, label: s.label ?? t(`contracts.${camel(s.feeType)}`) }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Space size={8} style={{ marginBottom: 12 }} wrap>
            <Typography.Text type="secondary">{t("contracts.freeRentQuick")}</Typography.Text>
            {[1, 2, 3].map((n) => (
              <Button
                key={n}
                size="small"
                onClick={() => {
                  const start = concessionForm.getFieldValue("effectiveStart") ?? termStart;
                  if (start) concessionForm.setFieldsValue({ effectiveStart: start, effectiveEnd: monthsFrom(start, n) });
                }}
              >
                {t("contracts.nMonths", { count: n })}
              </Button>
            ))}
          </Space>
          <Form.Item
            name="discountPercentage"
            label={
              <>
                {t("contracts.discountPercentage")} <HelpIcon field="concessionDiscount" />
              </>
            }
            rules={[{ required: true }]}
            initialValue={100}
          >
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editConcessionModal}
        onCancel={() => setEditConcessionModal(null)}
        onOk={onEditConcession}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editConcessionForm} layout="vertical">
          <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
            <Select allowClear placeholder={t("contracts.allStreams")} options={streams.map((s) => ({ value: s.id, label: s.label ?? t(`contracts.${camel(s.feeType)}`) }))} />
          </Form.Item>
          <Form.Item name="effectiveStart" label={t("contracts.serviceStart")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="effectiveEnd" label={t("contracts.serviceEnd")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item
            name="discountPercentage"
            label={
              <>
                {t("contracts.discountPercentage")} <HelpIcon field="concessionDiscount" />
              </>
            }
            rules={[{ required: true }]}
          >
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.addDepositTerms")} open={depositModal} onCancel={() => setDepositModal(false)} onOk={onSetDeposit} okText={t("common.save")} cancelText={t("common.cancel")}>
        <Form form={depositForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item
            name="requirementType"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="depositRequirementType" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="fixed"
          >
            <Select
              options={[
                { value: "fixed", label: t("contracts.fixedAmount") },
                { value: "formula", label: t("contracts.formula") },
              ]}
            />
          </Form.Item>
          <Form.Item name="depositAmountYuan" label={t("contracts.fixedAmount")} tooltip={t("contracts.depositAmountTooltip")}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="formulaBasis" label={t("contracts.formulaBasis")}>
            <Input placeholder={t("contracts.formulaBasisPlaceholder")} />
          </Form.Item>
          <Space size={8} style={{ marginBottom: 12 }} wrap>
            <Typography.Text type="secondary">{t("contracts.quickPick")}</Typography.Text>
            {[1, 2, 3].map((n) => (
              <Button key={n} size="small" onClick={() => depositForm.setFieldsValue({ requirementType: "formula", formulaBasis: t("contracts.monthsRent", { count: n }) })}>
                {t("contracts.monthsRent", { count: n })}
              </Button>
            ))}
          </Space>
        </Form>
      </Modal>

      <Modal
        title={t("common.edit")}
        open={!!editDepositModal}
        onCancel={() => setEditDepositModal(null)}
        onOk={onEditDepositTerms}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Form form={editDepositForm} layout="vertical">
          <Form.Item name="effectiveStart" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item
            name="requirementType"
            label={
              <>
                {t("contracts.calculationMethod")} <HelpIcon field="depositRequirementType" />
              </>
            }
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "fixed", label: t("contracts.fixedAmount") },
                { value: "formula", label: t("contracts.formula") },
              ]}
            />
          </Form.Item>
          <Form.Item name="depositAmountYuan" label={t("contracts.fixedAmount")} tooltip={t("contracts.depositAmountTooltip")}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="formulaBasis" label={t("contracts.formulaBasis")}>
            <Input placeholder={t("contracts.formulaBasisPlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.generateCharges")} open={generateModal} onCancel={() => setGenerateModal(false)} onOk={onGenerate} okText={t("contracts.generateCharges")} cancelText={t("common.cancel")}>
        <Form form={generateForm} layout="vertical">
          <Form.Item name="period" label={t("contracts.period")} rules={[{ required: true }]} initialValue={todayInChina().slice(0, 7)}>
            <MonthField />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={t("contracts.recordReceipt")} open={receiptModal} onCancel={() => setReceiptModal(false)} onOk={onRecordReceipt} okText={t("common.create")} cancelText={t("common.cancel")}>
        <Form form={receiptForm} layout="vertical">
          <Form.Item name="receivedDate" label={t("contracts.receivedDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="amountFen" label={t("contracts.amountYuan")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="paymentMethod" label={t("contracts.paymentMethod")} rules={[{ required: true }]} initialValue={PAYMENT_METHODS[0]}>
            <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: paymentMethodLabel(t, m) }))} />
          </Form.Item>
          <Form.Item name="externalReference" label={t("contracts.externalReference")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.editReceiptTitle")}
        open={!!editReceiptModal}
        onCancel={() => setEditReceiptModal(null)}
        onOk={onEditReceipt}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.editReceiptHint", { time: timeLeft(editReceiptModal?.editableUntil) })} />
        <Form form={editReceiptForm} layout="vertical">
          <Form.Item name="receivedDate" label={t("contracts.receivedDate")} rules={[{ required: true }]}>
            <DateField disabledDate={(d) => d.format("YYYY-MM-DD") > todayInChina()} />
          </Form.Item>
          <Form.Item name="amount" label={t("contracts.amountYuan")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0.01} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item name="paymentMethod" label={t("contracts.paymentMethod")} rules={[{ required: true }]}>
            <Select options={[...new Set([...PAYMENT_METHODS, editReceiptModal?.paymentMethod ?? ""].filter(Boolean))].map((m) => ({ value: m, label: paymentMethodLabel(t, m) }))} />
          </Form.Item>
          <Form.Item name="externalReference" label={t("contracts.externalReference")}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.editDepositTitle")}
        open={!!editDepositTxnModal}
        onCancel={() => setEditDepositTxnModal(null)}
        onOk={onEditDepositTxn}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t("contracts.editDepositHint", { time: timeLeft(editDepositTxnModal?.editableUntil) })} />
        <Form form={editDepositTxnForm} layout="vertical">
          <Form.Item name="transactionDate" label={t("contracts.transactionDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="amount" label={t("contracts.amountYuan")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0.01} precision={2} prefix="¥" />
          </Form.Item>
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.allocateTo")}
        open={!!allocateModal}
        onCancel={() => setAllocateModal(null)}
        onOk={onAllocate}
        okText={t("contracts.allocate")}
        cancelText={t("common.cancel")}
      >
        <Form
          form={allocateForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.chargeId === undefined || !allocateModal) return;
            // The most this receipt can put on that bill: its unallocated credit or the bill's balance, whichever is smaller.
            const credit = receiptBalances.find((r) => r.receiptId === allocateModal.receiptId)?.unallocatedFen ?? 0;
            const owed = chargeBalances.find((c) => c.chargeId === v.chargeId)?.balanceFen ?? 0;
            const fen = Math.min(credit, owed);
            if (fen > 0) allocateForm.setFieldsValue({ amountFen: fen / 100 });
          }}
        >
          <Form.Item name="chargeId" label={t("contracts.charges")} rules={[{ required: true }]}>
            <Select
              options={charges.map((c) => {
                const b = chargeBalances.find((x) => x.chargeId === c.id);
                return { value: c.id, label: `${t(`contracts.${camel(c.feeType)}`)} ${c.serviceStart} — ${b ? yuan(b.balanceFen) : ""}` };
              })}
            />
          </Form.Item>
          <Form.Item name="amountFen" label={t("contracts.amountYuan")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.reverse")}
        open={!!reverseReceiptModal}
        onCancel={() => setReverseReceiptModal(null)}
        onOk={onReverseReceipt}
        okText={t("contracts.reverse")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={reverseReceiptForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reversalReason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder={t("contracts.reversalReasonPlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.reject")}
        open={!!rejectAmendmentModal}
        onCancel={() => setRejectAmendmentModal(null)}
        onOk={onRejectAmendment}
        okText={t("contracts.reject")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={rejectAmendmentForm} layout="vertical">
          <Form.Item name="reviewReason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.reverse")}
        open={!!reverseDepositTxnModal}
        onCancel={() => setReverseDepositTxnModal(null)}
        onOk={onReverseDepositTxn}
        okText={t("contracts.reverse")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
      >
        <Form form={reverseDepositTxnForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reversalReason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.recordDepositTxn")}
        open={depositTxnModal}
        onCancel={() => setDepositTxnModal(false)}
        onOk={onRecordDepositTxn}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
      >
        <Form
          form={depositTxnForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (!v.transactionType) return;
            setDepositTxnType(v.transactionType);
            depositTxnForm.setFieldsValue({ amountFen: depositAmountFor(v.transactionType) });
          }}
        >
          <Form.Item
            name="transactionType"
            label={
              <>
                {t("contracts.transactionType")} <HelpIcon field="depositTxnType" />
              </>
            }
            rules={[{ required: true }]}
            initialValue="receipt"
          >
            <Select
              options={[
                { value: "receipt", label: t("contracts.depositReceipt") },
                ...(user?.role === "admin"
                  ? [
                      { value: "refund", label: t("contracts.refund") },
                      { value: "deduction", label: t("contracts.deduction") },
                      { value: "transfer_to_rent", label: t("contracts.transferToRent") },
                    ]
                  : []),
              ]}
            />
          </Form.Item>
          <Form.Item name="transactionDate" label={t("contracts.transactionDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item name="amountFen" label={t("contracts.amountYuan")} rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          {depositTxnType === "transfer_to_rent" && (
            <Form.Item name="chargeId" label={t("contracts.charges")} rules={[{ required: true }]}>
              <Select options={charges.map((c) => ({ value: c.id, label: `${t(`contracts.${camel(c.feeType)}`)} ${c.serviceStart}` }))} />
            </Form.Item>
          )}
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.editAmendment")}
        open={!!editAmendment}
        onCancel={() => setEditAmendment(null)}
        onOk={onSaveAmendment}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">{t("contracts.editAmendmentHint")}</Typography.Paragraph>
        <Form form={editAmendmentForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="internalCorrection" valuePropName="checked" label={t("contracts.internalCorrection")} extra={t("contracts.internalCorrectionHint")}>
            <Switch />
          </Form.Item>
          <Form.Item
            name="supportingDocumentId"
            label={t("contracts.supportingDocument")}
            extra={t("contracts.supportingDocumentHint")}
            dependencies={["internalCorrection"]}
            rules={[({ getFieldValue }) => ({ required: !getFieldValue("internalCorrection"), message: t("contracts.supportingDocumentRequired") })]}
          >
            <Select allowClear showSearch optionFilterProp="label" options={supportingDocOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("contracts.proposeAmendment")}
        open={amendmentModal}
        onCancel={() => {
          setAmendmentModal(false);
          setAmendmentKind("rate_change");
        }}
        onOk={onProposeAmendment}
        okText={t("common.create")}
        cancelText={t("common.cancel")}
        width={560}
      >
        <Form
          form={amendmentForm}
          layout="vertical"
          onValuesChange={(v) => {
            if (v.amendmentKind) setAmendmentKind(v.amendmentKind);
            if (v.amendmentKind === "billing_rules") {
              // Start from the rules as they are now, so only what changes needs touching.
              amendmentForm.setFieldsValue({
                amendDueDay: billingRulesInfo?.dueDay,
                amendDueMonthOffset: billingRulesInfo?.dueMonthOffset,
                amendGraceDays: billingRulesInfo?.overdueGraceDays,
                amendLateEnabled: billingRulesInfo?.latePenaltyEnabled ?? false,
                amendLateRate: billingRulesInfo?.latePenaltyDailyRatePermille != null ? Number(billingRulesInfo.latePenaltyDailyRatePermille) : undefined,
                amendLateCap: billingRulesInfo?.latePenaltyCapFen != null ? billingRulesInfo.latePenaltyCapFen / 100 : undefined,
              });
            }
            if (v.amendStreamTargetType) setAmendmentStreamTargetType(v.amendStreamTargetType);
            if (isUsageFee(v.amendStreamCalculationMethod)) {
              amendmentForm.setFieldsValue({ amendStreamRateBasis: usageFeeBasis(v.amendStreamCalculationMethod) });
              if (meteredStreamOptions.length === 1) amendmentForm.setFieldsValue({ amendStreamLinkedStreamId: meteredStreamOptions[0].value });
            }
            if (v.amendUnitId !== undefined && areaOfUnit(v.amendUnitId)) amendmentForm.setFieldsValue({ amendContractedAreaSqm: Number(areaOfUnit(v.amendUnitId)) });
          }}
        >
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="effectiveDate" label={t("contracts.effectiveDate")} rules={[{ required: true }]}>
            <DateField />
          </Form.Item>
          <Form.Item
            name="internalCorrection"
            valuePropName="checked"
            label={
              <>
                {t("contracts.internalCorrection")} <HelpIcon field="amendmentType" />
              </>
            }
            extra={t("contracts.internalCorrectionHint")}
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="supportingDocumentId"
            label={t("contracts.supportingDocument")}
            extra={t("contracts.supportingDocumentHint")}
            dependencies={["internalCorrection"]}
            rules={[({ getFieldValue }) => ({ required: !getFieldValue("internalCorrection"), message: t("contracts.supportingDocumentRequired") })]}
          >
            <Select allowClear showSearch optionFilterProp="label" options={supportingDocOptions} />
          </Form.Item>
          <Form.Item name="amendmentKind" label={t("contracts.amendmentKind")} initialValue="rate_change">
            <Select
              options={[
                { value: "rate_change", label: t("contracts.amendmentKindRateChange") },
                { value: "add_unit", label: t("contracts.amendmentKindAddUnit") },
                { value: "add_pricing_stream", label: t("contracts.amendmentKindAddPricingStream") },
                { value: "terminate", label: t("contracts.amendmentKindTerminate") },
                { value: "void_document", label: t("contracts.amendmentKindVoidDocument") },
                { value: "billing_rules", label: t("contracts.amendmentKindBillingRules") },
              ]}
            />
          </Form.Item>

          {amendmentKind === "rate_change" && (
            <>
              <Form.Item name="pricingStreamId" label={t("contracts.pricingStreams")}>
                <Select allowClear options={streams.map((s) => ({ value: s.id, label: s.label ?? t(`contracts.${camel(s.feeType)}`) }))} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.pricingStreamId !== cur.pricingStreamId}>
                {({ getFieldValue }) => {
                  const cur = rates.find((r) => r.pricingStreamId === getFieldValue("pricingStreamId") && !r.effectiveEnd);
                  return cur ? (
                    <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
                      {t("contracts.currentRate", { rate: `${cur.amountOrRate} (${t(`contracts.${camel(cur.rateBasis)}`)}${cur.unit ? ` / ${cur.unit}` : ""})` })}
                    </Typography.Paragraph>
                  ) : null;
                }}
              </Form.Item>
              <Form.Item name="newAmountOrRate" label={t("contracts.newAmountOrRate")}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.pricingStreamId !== cur.pricingStreamId}>
                {({ getFieldValue }) => {
                  const currentRate = rates.find((r) => r.pricingStreamId === getFieldValue("pricingStreamId") && !r.effectiveEnd);
                  return (
                    isMeteredMethod(currentRate?.calculationMethod) && (
                      <Form.Item
                        name="amendRateUnit"
                        label={t("contracts.meteredUnit")}
                        rules={[{ required: true }]}
                        initialValue={currentRate?.unit ?? undefined}
                      >
                        <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                      </Form.Item>
                    )
                  );
                }}
              </Form.Item>
            </>
          )}

          {amendmentKind === "add_unit" && (
            <>
              <Form.Item name="amendUnitId" label={t("properties.unitLabel")} rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={availableUnits.map((u) => ({ value: u.id, label: u.unitLabel }))} />
              </Form.Item>
              <Form.Item name="amendContractedAreaSqm" label={t("contracts.contractedArea")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} />
              </Form.Item>
              <Typography.Text type="secondary">{t("contracts.amendAddUnitHint")}</Typography.Text>
            </>
          )}

          {amendmentKind === "add_pricing_stream" && (
            <>
              <Form.Item name="amendStreamFeeType" label={t("contracts.feeType")} rules={[{ required: true }]} initialValue="rent">
                <Select options={feeTypes.map((f) => ({ value: f, label: t(`contracts.${camel(f)}`) }))} />
              </Form.Item>
              <Form.Item name="amendStreamTargetType" label={t("contracts.pricingScope")} rules={[{ required: true }]} initialValue="unit">
                <Select
                  options={[
                    { value: "unit", label: t("contracts.units") },
                    { value: "contract", label: t("contracts.title") },
                  ]}
                />
              </Form.Item>
              <Form.Item name="amendStreamLabel" label={t("common.name")}>
                <Input />
              </Form.Item>
              {amendmentStreamTargetType === "unit" && (
                <Form.Item name="amendStreamContractUnitIds" label={t("contracts.units")} rules={[{ required: true }]}>
                  <Select mode="multiple" options={units.map((u) => ({ value: u.id, label: availableUnits.find((au) => au.id === u.unitId)?.unitLabel ?? u.unitId }))} />
                </Form.Item>
              )}
              <Form.Item name="amendStreamCalculationMethod" label={t("contracts.calculationMethod")} rules={[{ required: true }]} initialValue="flat">
                <Select options={methodOptions} />
              </Form.Item>
              {isUsageFee(amendStreamMethod) && linkedStreamField("amendStreamLinkedStreamId")}
              <Form.Item name="amendStreamRateBasis" label={t("contracts.rateBasis")} rules={[{ required: true }]} initialValue="per_month">
                <Select disabled={isUsageFee(amendStreamMethod)} options={rateBases.map((b) => ({ value: b, label: t(`contracts.${camel(b)}`) }))} />
              </Form.Item>
              <Form.Item name="amendStreamAmountOrRate" label={t("contracts.amountOrRate")} hidden={amendStreamMethod === "metered_amount"} rules={[{ required: amendStreamMethod !== "metered_amount" }]} extra={usageFeeValueExtra(amendStreamMethod)}>
                <InputNumber style={{ width: "100%" }} min={0} max={amendStreamMethod === "usage_fee_percent" ? 100 : undefined} />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.amendStreamCalculationMethod !== cur.amendStreamCalculationMethod}>
                {({ getFieldValue }) =>
                  isMeteredMethod(getFieldValue("amendStreamCalculationMethod")) && (
                    <Form.Item name="amendStreamUnit" label={t("contracts.meteredUnit")} rules={[{ required: true }]}>
                      <Input placeholder={t("contracts.meteredUnitPlaceholder")} />
                    </Form.Item>
                  )
                }
              </Form.Item>
              <Typography.Text type="secondary">{t("contracts.amendAddStreamHint")}</Typography.Text>
            </>
          )}

          {amendmentKind === "terminate" && <Typography.Text type="secondary">{t("contracts.amendTerminateHint")}</Typography.Text>}
          {amendmentKind === "billing_rules" && (
            <>
              <Typography.Paragraph type="secondary">{t("contracts.amendBillingRulesHint")}</Typography.Paragraph>
              <Form.Item name="amendDueDay" label={t("contracts.dueDay")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={1} max={31} />
              </Form.Item>
              <Form.Item name="amendDueMonthOffset" label={t("contracts.dueMonthOffset")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={-12} max={12} />
              </Form.Item>
              <Form.Item name="amendGraceDays" label={t("billing.graceDays")} rules={[{ required: true }]}>
                <InputNumber style={{ width: "100%" }} min={0} max={60} />
              </Form.Item>
              <Form.Item name="amendLateEnabled" label={t("contracts.latePenaltyEnabled")} valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(a, b) => a.amendLateEnabled !== b.amendLateEnabled}>
                {({ getFieldValue }) =>
                  getFieldValue("amendLateEnabled") ? (
                    <>
                      <Form.Item name="amendLateRate" label={t("contracts.latePenaltyDailyRate")} rules={[{ required: true }]}>
                        <InputNumber style={{ width: "100%" }} min={0} max={100} step={0.1} />
                      </Form.Item>
                      <Form.Item name="amendLateCap" label={t("contracts.latePenaltyCap")}>
                        <InputNumber style={{ width: "100%" }} min={0} />
                      </Form.Item>
                    </>
                  ) : null
                }
              </Form.Item>
            </>
          )}
          {amendmentKind === "void_document" && (
            <Form.Item name="voidDocumentIds" label={t("contracts.documentsToVoid")} extra={t("contracts.voidDocumentHint")} rules={[{ required: true }]}>
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={documents
                  // Evidence for another amendment can't be withdrawn.
                  .filter((d) => !amendments.some((a) => ["draft", "pending", "approved"].includes(a.status) && a.supportingDocumentId === d.id))
                  .map((d) => ({ value: d.id, label: `${docDisplayName(t, d)}${d.name?.trim() ? ` · ${docTypeLabel(t, d.docType)}` : ""} (${d.uploadedAt.slice(0, 10)})` }))}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <CatchUpBillingModal open={catchUpOpen} contractId={contract.id} onClose={() => setCatchUpOpen(false)} onDone={load} />
      <RecordPaymentModal open={paymentOpen} contractId={contract.id} onClose={() => setPaymentOpen(false)} onDone={load} />
      <BulkPaymentsModal open={bulkPaymentOpen} contractId={contract.id} onClose={() => setBulkPaymentOpen(false)} onDone={load} />
      <MeterReadingsGridModal
        open={readingsGridOpen}
        contractId={contract.id}
        termStart={contract.termStart}
        termEnd={contract.termEnd}
        streams={streams
          .filter((s) => rates.some((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod)))
          .map((s) => ({
            id: s.id,
            name: s.label ?? t(`contracts.${camel(s.feeType)}`),
            unit: rates.find((r) => r.pricingStreamId === s.id && isMeteredMethod(r.calculationMethod))?.unit ?? "",
            amountMode: rates.some((r) => r.pricingStreamId === s.id && r.calculationMethod === "metered_amount"),
          }))}
        usageEntries={usageEntries}
        charges={charges}
        onClose={() => setReadingsGridOpen(false)}
        onDone={load}
      />
      <ChargeDetailDrawer
        chargeId={detailChargeId}
        onClose={() => setDetailChargeId(null)}
        onVoid={user?.role === "admin" ? (cid) => { setDetailChargeId(null); setVoidModal({ chargeId: cid }); } : undefined}
      />
      <Modal
        title={t("billing.void.title")}
        open={!!voidModal}
        onCancel={() => setVoidModal(null)}
        onOk={onVoidCharge}
        okText={t("billing.void.button")}
        okButtonProps={{ danger: true }}
        cancelText={t("common.cancel")}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">{t("billing.void.body")}</Typography.Paragraph>
        <Form form={voidForm} layout="vertical">
          <Form.Item name="reason" label={t("contracts.reason")} rules={[{ required: true, min: 3 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
