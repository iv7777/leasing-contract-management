export type Role = "admin" | "manager" | "collector" | "viewer";

export const ROLES: Role[] = ["admin", "manager", "collector", "viewer"];

export type Locale = "en" | "zh";

export type DocumentClassification = "ordinary" | "sensitive";

export type PartyType = "company" | "individual";

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  canDownloadPdf: boolean;
  canPrint: boolean;
  preferredLocale: Locale;
  propertyIds: number[];
}

export interface PropertyDto {
  id: number;
  name: string;
  nameEn: string | null;
  address: string;
  archived: boolean;
}

export interface UnitDto {
  id: number;
  propertyId: number;
  unitLabel: string;
  unitType: string;
  rentableAreaSqm: string; // exact decimal as string
  availability: "vacant" | "leased" | "unavailable";
}

export interface PartyDto {
  id: number;
  type: PartyType;
  name: string;
  nameEn: string | null;
  contactDetails: string | null;
  archived: boolean;
}

/** Standard API error shape: code is a stable key the frontend maps to a
 * translated message; message is an English fallback for logs, never shown
 * directly to end users in place of the localized string. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
