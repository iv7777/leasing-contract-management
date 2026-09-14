import { useEffect, useState } from "react";
import { List, Tag, Typography, Empty } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

interface Reminder {
  contractId: number;
  referenceNumber: string;
  type: "renewal_notice" | "rate_change" | "deposit_shortfall" | "overdue_balance";
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
      case "overdue_balance":
        return t("reminders.overdueBalanceMessage", {
          days: r.params.daysOverdue,
          balance: yuan(Number(r.params.balanceFen)),
          dueDate: r.params.dueDate,
        });
      default:
        return "";
    }
  };

  return (
    <div>
      <Typography.Title level={4}>{t("reminders.title")}</Typography.Title>
      {!loading && reminders.length === 0 && <Empty description={t("reminders.empty")} />}
      <List
        loading={loading}
        dataSource={reminders}
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
