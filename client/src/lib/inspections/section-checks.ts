/**
 * Shared check-key registry for the BRCGS 3.5.1 / FSSC 22000 incoming
 * inspection sections. Lives outside the mobile wizard so the desktop
 * read-only detail page can render the same labels without dragging
 * the whole wizard in.
 *
 * The mobile wizard imports this module too — keep changes here in
 * sync with the operator-facing UX.
 */

export interface CheckRow {
  key: string;
  label: string;
}

export const VEHICLE_CHECKS: CheckRow[] = [
  { key: "clean_and_hygienic", label: "Vehicle interior clean and hygienic" },
  { key: "no_signs_of_pests", label: "No signs of pest activity" },
  {
    key: "no_chemical_or_odour_contamination",
    label: "No chemical or strong odour contamination",
  },
  {
    key: "previous_cargo_acceptable",
    label: "Previous cargo acceptable / compatible",
  },
  { key: "structurally_sound", label: "Vehicle structurally sound" },
  { key: "seal_intact_or_na", label: "Seal intact (or N/A)" },
];

export const DOC_CHECKS: CheckRow[] = [
  { key: "coa_received", label: "Certificate of Analysis received" },
  { key: "coa_matches_spec", label: "COA matches the agreed specification" },
  {
    key: "country_of_origin_verified",
    label: "Country of origin verified",
  },
  {
    key: "radiological_risk_acceptable",
    label: "Radiological risk acceptable for source country",
  },
  {
    key: "food_fraud_risk_acceptable",
    label: "Food-fraud risk acceptable",
  },
  { key: "delivery_matches_po", label: "Delivery matches the PO" },
];

export const PHYSICAL_CHECKS: CheckRow[] = [
  { key: "packaging_intact", label: "Outer packaging intact" },
  { key: "no_foreign_materials", label: "No visible foreign materials" },
  { key: "correct_labelling", label: "Correct labelling on every unit" },
  { key: "tamper_evidence_intact", label: "Tamper-evidence intact" },
  { key: "correct_material", label: "Material matches what was ordered" },
];

export const FOOD_SAFETY_CHECKS: CheckRow[] = [
  {
    key: "no_microbial_contamination",
    label: "No signs of microbial contamination",
  },
  {
    key: "no_chemical_contamination_signs",
    label: "No signs of chemical contamination",
  },
  {
    key: "no_physical_contamination",
    label: "No physical contamination (glass, metal, plastic)",
  },
  { key: "allergen_info_verified", label: "Allergen information verified" },
  {
    key: "no_signs_of_fraud_or_substitution",
    label: "No signs of fraud or substitution",
  },
  {
    key: "no_malicious_tampering_evidence",
    label: "No evidence of malicious tampering",
  },
];

export const STORAGE_CHECKS: CheckRow[] = [
  {
    key: "stored_in_designated_area",
    label: "Stored in the designated quarantine area",
  },
  {
    key: "allergen_segregation_maintained",
    label: "Allergen segregation maintained",
  },
  {
    key: "storage_conditions_acceptable",
    label: "Storage conditions acceptable (temp / humidity)",
  },
];

export type InspectionSectionKey =
  | "vehicle_inspection"
  | "documentation_verification"
  | "physical_inspection"
  | "food_safety_checks"
  | "storage_verification";

export const INSPECTION_SECTIONS: Array<{
  key: InspectionSectionKey;
  title: string;
  checks: CheckRow[];
}> = [
  { key: "vehicle_inspection", title: "Vehicle inspection", checks: VEHICLE_CHECKS },
  {
    key: "documentation_verification",
    title: "Documentation verification",
    checks: DOC_CHECKS,
  },
  { key: "physical_inspection", title: "Physical inspection", checks: PHYSICAL_CHECKS },
  { key: "food_safety_checks", title: "Food-safety checks", checks: FOOD_SAFETY_CHECKS },
  { key: "storage_verification", title: "Storage verification", checks: STORAGE_CHECKS },
];
