import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

export interface ContractOverdueDto {
  contractId: number;
  overdueFen: number;
  overdueCount: number;
  maxDaysOverdue: number;
}

export interface PropertyOverdueDto {
  propertyId: number;
  contractCount: number;
  overdueFen: number;
}

/** Who is overdue, for the red tags on the Contracts and Properties lists.
 * Silent on failure: a missing tag must never break the list itself. */
export function useOverdueSummary() {
  const [data, setData] = useState<{ contracts: ContractOverdueDto[]; properties: PropertyOverdueDto[] } | null>(null);

  useEffect(() => {
    void api
      .get<{ contracts: ContractOverdueDto[]; properties: PropertyOverdueDto[] }>("/billing/overdue-summary")
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return useMemo(
    () => ({
      byContract: new Map((data?.contracts ?? []).map((c) => [c.contractId, c])),
      byProperty: new Map((data?.properties ?? []).map((p) => [p.propertyId, p])),
    }),
    [data],
  );
}
