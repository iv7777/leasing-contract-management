import type { PartyDto } from "@lcm/shared";

export type PartyRole = "tenant" | "landlord";

interface ContractParties {
  landlordPartyId: number;
  tenantPartyId: number;
}

/** The parties a Tenants or Landlords list shows. A party has no role of its own: it is a tenant on the
 * contracts that name it as tenant and a landlord on those that name it as landlord. So a party is listed under
 * a role when it holds that role on some contract, and under both while it is on no contract yet (a new party
 * must appear where it was just added). `alwaysId` keeps a linked-to party visible. */
export function partiesForRole(parties: PartyDto[], contracts: ContractParties[], role: PartyRole, alwaysId?: number | null): PartyDto[] {
  const tenants = new Set(contracts.map((c) => c.tenantPartyId));
  const landlords = new Set(contracts.map((c) => c.landlordPartyId));
  return parties.filter((p) => {
    if (p.id === alwaysId) return true;
    const used = tenants.has(p.id) || landlords.has(p.id);
    if (!used) return true;
    return role === "tenant" ? tenants.has(p.id) : landlords.has(p.id);
  });
}

/** True when the party is on no contract at all (so it is listed under both roles). */
export function onNoContract(partyId: number, contracts: ContractParties[]): boolean {
  return !contracts.some((c) => c.tenantPartyId === partyId || c.landlordPartyId === partyId);
}
