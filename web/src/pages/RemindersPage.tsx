import { useEffect, useState } from "react";
import { List, Space, Tag, Typography, Empty } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

type ReminderType = "renewal_notice" | "rate_change" | "deposit_shortfall" | "deposit_check" | "overdue_balance" | "missing_reading";
const TYPES: ReminderType[] = ["overdue_balance", "missing_reading", "deposit_shortfall", "deposit_check", "renewal_notice", "rate_change"];

interface Reminder {
  contractId: number;
  referenceNumber: string;
  type: ReminderType;
  severity: "info" | "warning" | "critical";
  date: string;
  params: Record<string, string | number>;
}

const severityColor: Record<Reminder["severity"], string> = { info: "blue", warning: "orange", critical: "red" };
const yuan = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

export default function RemindersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ReminderType | "all">("all");

  useEffect(() => {
    void api
      .get<{ reminders: Reminder[] }>("/reminders")
      .then((r) => setReminders(r.reminders))
      .finally(() => setLoading(false));
  }, []);

  const describe = (r: Reminder) => {
    switch (r.type) {
      case "renewal_notice":
        return t("reminders.renewalNoticeMessage", { termEnd: r.params.termEnd, daysLeft: r.params.daysLeft });
      case "rate_change":
        return t("reminders.rateChangeMessage", { label: r.params.pricingStreamLabel, effectiveStart: r.params.effectiveStart });
      case "deposit_shortfall":
        return t("reminders.depositShortfallMessage", {
          held: yuan(Number(r.params.depositHeldFen)),
          required: yuan(Number(r.params.depositRequiredFen)),
        });
      case "deposit_check":
        return t("reminders.depositCheckMessage", { held: yuan(Number(r.params.depositHeldFen)) });
      case "overdue_balance":
        return t("reminders.overdueBalanceMessage", {
          count: Number(r.params.count),
          days: r.params.daysOverdue,
          balance: yuan(Number(r.params.balanceFen)),
          dueDate: r.params.dueDate,
        });
      case "missing_reading":
        return t("reminders.missingReadingMessage", { count: Number(r.params.count), streams: r.params.streams, months: r.params.months });
      default:
        return "";
    }
  };

  return (
    <div>
      <Typography.Title level={4}>{t("reminders.title")}</Typography.Title>
      {!loading && reminders.length === 0 && <Empty description={t("reminders.empty")} />}
      {reminders.length > 0 && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag.CheckableTag checked={filter === "all"} onChange={() => setFilter("all")}>
            {t("reminders.all")} ({reminders.length})
          </Tag.CheckableTag>
          {TYPES.filter((ty) => reminders.some((r) => r.type === ty)).map((ty) => (
            <Tag.CheckableTag key={ty} checked={filter === ty} onChange={() => setFilter(ty)}>
              {t(`reminders.${ty}`)} ({reminders.filter((r) => r.type === ty).length})
            </Tag.CheckableTag>
          ))}
        </Space>
      )}
      <List
        loading={loading}
        dataSource={filter === "all" ? reminders : reminders.filter((r) => r.type === filter)}
        renderItem={(r) => (
          <List.Item onClick={() => navigate(`/contracts/${r.contractId}`)} style={{ cursor: "pointer" }}>
            <List.Item.Meta
              title={
                <span>
                  <Tag color={severityColor[r.severity]}>{t(`reminders.${r.type}`)}</Tag> {r.referenceNumber}
                </span>
              }
              description={describe(r)}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
