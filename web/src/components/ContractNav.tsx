import { useEffect, useMemo, useState } from "react";
import { Button, Space, Tooltip, Typography } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { loadContractOrder } from "../lib/contractNav";

interface Row {
  id: number;
  referenceNumber: string;
  archived: boolean;
}

// Fetched once per visit to the page, whichever contract is open.
let cache: Row[] | null = null;

/** ‹ 3 / 12 › — step to the previous or next contract in the order of the list you came from (or all contracts). */
export default function ContractNav({ currentId }: { currentId: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(cache);

  useEffect(() => {
    let live = true;
    void api
      .get<{ contracts: Row[] }>("/contracts")
      .then((r) => {
        cache = r.contracts;
        if (live) setRows(r.contracts);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const order = useMemo(() => {
    if (!rows) return [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const stored = loadContractOrder();
    if (stored && stored.includes(currentId)) return stored.map((id) => byId.get(id)).filter((r): r is Row => !!r);
    const current = byId.get(currentId);
    return rows.filter((r) => !r.archived || r.id === currentId || current?.archived);
  }, [rows, currentId]);

  const index = order.findIndex((r) => r.id === currentId);
  if (index < 0 || order.length < 2) return null;
  const prev = order[index - 1];
  const next = order[index + 1];

  const step = (r: Row | undefined, label: string, icon: React.ReactNode, aria: string) => (
    <Tooltip title={r ? `${label}: ${r.referenceNumber}` : undefined}>
      <Button size="small" icon={icon} disabled={!r} aria-label={aria} onClick={() => r && navigate(`/contracts/${r.id}`)} />
    </Tooltip>
  );

  return (
    <Space size={4}>
      {step(prev, t("contracts.previous"), <LeftOutlined />, t("contracts.previous"))}
      <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {index + 1} / {order.length}
      </Typography.Text>
      {step(next, t("contracts.next"), <RightOutlined />, t("contracts.next"))}
    </Space>
  );
}
