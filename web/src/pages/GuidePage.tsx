import { Alert, Descriptions, Space, Table, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useHelpTopic } from "../help/HelpContext";

const steps = (text: string) => text.split("\n").filter(Boolean);

function StepList({ items }: { items: string[] }) {
  return (
    <ol style={{ paddingInlineStart: 20, margin: 0 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {item}
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  const { t } = useTranslation();
  useHelpTopic("guide");

  const sections = [
    { id: "overview", label: t("help.guide.overview.heading") },
    { id: "workflow", label: t("help.guide.workflow.heading") },
    { id: "tasks", label: t("help.guide.commonTasks.heading") },
    { id: "roles", label: t("help.guide.roles.heading") },
  ];

  const roleRows = [
    { key: "admin", role: t("users.admin"), description: t("help.guide.roles.admin") },
    { key: "manager", role: t("users.manager"), description: t("help.guide.roles.manager") },
    { key: "collector", role: t("users.collector"), description: t("help.guide.roles.collector") },
    { key: "viewer", role: t("users.viewer"), description: t("help.guide.roles.viewer") },
  ];

  return (
    <div>
      <Typography.Title level={4}>{t("help.guide.title")}</Typography.Title>
      <Typography.Paragraph type="secondary">{t("help.guide.intro")}</Typography.Paragraph>

      <Space wrap style={{ marginBottom: 32 }}>
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </Space>

      <Typography.Title level={5} id="overview">
        {t("help.guide.overview.heading")}
      </Typography.Title>
      <Typography.Paragraph>{t("help.guide.overview.body")}</Typography.Paragraph>
      <Descriptions bordered column={1} size="small" style={{ marginBottom: 40 }}>
        <Descriptions.Item label={t("properties.title")}>{t("help.guide.overview.entityProperty")}</Descriptions.Item>
        <Descriptions.Item label={t("parties.title")}>{t("help.guide.overview.entityParty")}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.title")}>{t("help.guide.overview.entityContract")}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.pricingStreams")}>{t("help.guide.overview.entityPricing")}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.depositTerms")}>{t("help.guide.overview.entityDeposit")}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.charges")}>{t("help.guide.overview.entityCharges")}</Descriptions.Item>
        <Descriptions.Item label={t("contracts.amendments")}>{t("help.guide.overview.entityAmendments")}</Descriptions.Item>
        <Descriptions.Item label={t("reminders.title")}>{t("help.guide.overview.entityReminders")}</Descriptions.Item>
      </Descriptions>

      <Typography.Title level={5} id="workflow">
        {t("help.guide.workflow.heading")}
      </Typography.Title>
      <Typography.Paragraph>{t("help.guide.workflow.intro")}</Typography.Paragraph>
      <div style={{ marginBottom: 40 }}>
        <StepList items={steps(t("help.guide.workflow.steps"))} />
      </div>

      <Typography.Title level={5} id="tasks">
        {t("help.guide.commonTasks.heading")}
      </Typography.Title>

      <Typography.Title level={5} style={{ fontSize: 15 }}>
        {t("help.guide.commonTasks.payment.heading")}
      </Typography.Title>
      <div style={{ marginBottom: 24 }}>
        <StepList items={steps(t("help.guide.commonTasks.payment.steps"))} />
      </div>

      <Typography.Title level={5} style={{ fontSize: 15 }}>
        {t("help.guide.commonTasks.rentIncrease.heading")}
      </Typography.Title>
      <div style={{ marginBottom: 24 }}>
        <StepList items={steps(t("help.guide.commonTasks.rentIncrease.steps"))} />
      </div>

      <Typography.Title level={5} style={{ fontSize: 15 }}>
        {t("help.guide.commonTasks.earlyTermination.heading")}
      </Typography.Title>
      <div style={{ marginBottom: 40 }}>
        <StepList items={steps(t("help.guide.commonTasks.earlyTermination.steps"))} />
      </div>

      <Typography.Title level={5} id="roles">
        {t("help.guide.roles.heading")}
      </Typography.Title>
      <Typography.Paragraph>{t("help.guide.roles.intro")}</Typography.Paragraph>
      <Table
        bordered
        pagination={false}
        size="small"
        dataSource={roleRows}
        style={{ marginBottom: 12 }}
        columns={[
          { title: t("users.role"), dataIndex: "role", width: 140 },
          { title: t("help.guide.roles.canDoHeading"), dataIndex: "description" },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 40 }}>
        {t("help.guide.roles.assignedPropertiesNote")}
      </Typography.Paragraph>

      <Alert type="info" showIcon message={t("help.guide.moreHelp")} />
    </div>
  );
}
