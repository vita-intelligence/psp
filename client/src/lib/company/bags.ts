// Shared types + constants for the JSONB "bag" settings on Company.
// The backend stashes whatever shape we send under each `field`; this
// file is the frontend's source of truth for those shapes so all
// sections agree.

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const WEEKDAYS: Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** `null` = day is closed. `"HH:MM"` strings otherwise. */
export interface DayHours {
  opens_at: string | null;
  closes_at: string | null;
}

export type WorkingHours = Partial<Record<Weekday, DayHours | null>>;

export interface Holiday {
  date: string; // YYYY-MM-DD
  label?: string;
}

export interface HolidaysBag {
  items: Holiday[];
}

export interface CurrencyRate {
  currency: string;
  rate: number;
}

export interface CurrencyRatesBag {
  rates: CurrencyRate[];
}

export interface AllowedIp {
  cidr: string;
  label?: string;
}

export interface AllowedIpsBag {
  enabled: boolean;
  items: AllowedIp[];
}

export interface NumberingFormat {
  prefix: string;
  padding: number;
}

export type NumberingFormats = Partial<Record<string, NumberingFormat>>;

/** Entities that currently have ID number generation in PSP.
 *  **Standing rule:** every new DB-backed table in PSP must add an
 *  entry here in the same commit it ships, so admins can configure
 *  its prefix + padding. */
export const NUMBERING_ENTITIES: Array<{ key: string; label: string }> = [
  { key: "user", label: "Users" },
  { key: "warehouse", label: "Warehouses" },
  { key: "template", label: "Permission templates" },
  { key: "floor", label: "Floors" },
  { key: "storage_location", label: "Storage locations" },
  { key: "storage_cell", label: "Storage cells" },
  { key: "storage_tag", label: "Storage tags" },
  { key: "unit_of_measurement", label: "Units of measurement" },
  { key: "item", label: "Items" },
  { key: "product_family", label: "Product families" },
  { key: "attribute_definition", label: "Attribute definitions" },
  { key: "certificate", label: "Certificates" },
  // Procurement + stock + device entities — registered server-side in
  // Backend.Numbering @entity_schemas; surface them here so admins can
  // configure VN / P0 / LOT prefixes from /settings/company.
  { key: "vendor", label: "Vendors" },
  { key: "purchase_order", label: "Purchase orders" },
  { key: "stock_lot", label: "Stock lots" },
  { key: "linked_device", label: "Linked devices" },
];
