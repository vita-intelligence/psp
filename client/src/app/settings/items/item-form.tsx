"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Loader2,
  Lock,
  LockKeyhole,
  Paperclip,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { TagPicker } from "@/components/forms/tag-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge-mini";
import { ErrorBanner } from "@/components/forms/error-banner";
import { FieldError } from "@/components/forms/field-error";
import { CollabAvatars } from "@/components/realtime/collab-avatars";
import { FieldEditingIndicator } from "@/components/realtime/field-editing-indicator";
import { RemoteCursor } from "@/components/realtime/remote-cursor";
import {
  useLiveForm,
  type CollabPeer,
  type JoinError,
} from "@/lib/realtime/use-live-form";
import { useFormPresenceBeacon } from "@/lib/realtime/use-form-presence-beacon";
import { invalidateAudit, subscribeRestore } from "@/lib/audit/invalidator";
import {
  createItemAction,
  deleteItemAction,
  markItemReadyAction,
  revertItemToDraftAction,
  updateItemFullAction,
  uploadItemFileAction,
} from "@/lib/items/actions";
import type { ErrorResult } from "@/lib/errors/server";
import type {
  Allergen,
  AllergenStatus,
  AttributeDefinition,
  CapsuleSize,
  DosageForm,
  GmoStatus,
  HalalStatus,
  Item,
  ItemFile,
  ItemFileKind,
  ItemType,
  KosherStatus,
  NovelFoodStatus,
  OrganicStatus,
  PackagingMaterial,
  PowderType,
  ProductFamily,
  RawMaterialUseAs,
  RegulatoryCategory,
  RiskLevel,
  StorageTag,
  UnitOfMeasurement,
  VeganStatus,
} from "@/lib/types";

interface FormProps {
  /** `null` ⇒ new item; otherwise the row being edited. */
  item: Item | null;
  canEdit: boolean;
  canEditRisk: boolean;
  canApproveRisk: boolean;
  /** Picker data — pre-fetched server-side. */
  units: UnitOfMeasurement[];
  families: ProductFamily[];
  attributeDefinitions: AttributeDefinition[];
  /** All EU 14 allergens — used by the may-contain section. */
  allAllergens: Allergen[];
  /** Company storage tag registry. Powers the storage_tags picker —
   *  same vocabulary used by storage locations + cells so allocation
   *  matches are a single set check. */
  storageTags: StorageTag[];
  /** Fired on successful save so the EditModeToggle wrapper flips
   *  the page back to view mode. */
  onSavedSuccess?: () => void;
}

const ITEM_TYPE_OPTIONS: Array<{ value: ItemType; label: string; desc: string }> = [
  { value: "raw_material", label: "Raw material", desc: "Powder, extract, oil — the inputs" },
  { value: "semi_finished", label: "Semi-finished", desc: "Blends, granulates, intermediates" },
  { value: "finished_product", label: "Finished product", desc: "The SKU shipped to the customer" },
  { value: "packaging", label: "Packaging", desc: "Bottles, caps, labels, cartons" },
  { value: "consumable", label: "Consumable", desc: "PPE, sanitiser, food-grade lube, lab reagents, spare parts" },
  { value: "equipment", label: "Equipment", desc: "Serial-tracked units — mixers, scales, forklifts, laptops, pH meters" },
];

const USE_AS_OPTIONS: Array<{ value: RawMaterialUseAs; label: string }> = [
  { value: "active", label: "Active" },
  { value: "sweetener", label: "Sweetener" },
  { value: "bulking_agent", label: "Bulking agent" },
  { value: "flavouring", label: "Flavouring" },
  { value: "colour", label: "Colour" },
  { value: "acidity_regulator", label: "Acidity regulator" },
  { value: "glazing_agent", label: "Glazing agent" },
  { value: "gelling_agent", label: "Gelling agent" },
  { value: "emulsifier", label: "Emulsifier" },
  { value: "disintegrant", label: "Disintegrant" },
  { value: "stabiliser", label: "Stabiliser" },
  { value: "anti_caking", label: "Anti-caking" },
  { value: "coating", label: "Coating" },
  { value: "preservative", label: "Preservative" },
  { value: "carrier", label: "Carrier" },
  { value: "excipient", label: "Excipient" },
  { value: "other", label: "Other" },
];

const ALLERGEN_STATUS_OPTIONS: Array<{ value: AllergenStatus; label: string }> = [
  { value: "free", label: "Free" },
  { value: "contains_traces", label: "Contains traces" },
  { value: "contains", label: "Contains" },
];

const VEGAN_OPTIONS: Array<{ value: VeganStatus; label: string }> = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "non_vegetarian", label: "Non-vegetarian" },
  { value: "unknown", label: "Unknown" },
];

const TRI_STATUS_HALAL: Array<{ value: HalalStatus; label: string }> = [
  { value: "certified", label: "Certified" },
  { value: "not_certified", label: "Not certified" },
  { value: "not_applicable", label: "Not applicable" },
];

const TRI_STATUS_KOSHER: Array<{ value: KosherStatus; label: string }> = [
  { value: "certified", label: "Certified" },
  { value: "not_certified", label: "Not certified" },
  { value: "not_applicable", label: "Not applicable" },
];

const ORGANIC_OPTIONS: Array<{ value: OrganicStatus; label: string }> = [
  { value: "certified", label: "Certified" },
  { value: "in_conversion", label: "In conversion" },
  { value: "non_organic", label: "Non-organic" },
  { value: "not_applicable", label: "Not applicable" },
];

const NOVEL_FOOD_OPTIONS: Array<{ value: NovelFoodStatus; label: string }> = [
  { value: "not_novel", label: "Not novel" },
  { value: "authorised", label: "Authorised" },
  { value: "pending", label: "Pending" },
  { value: "not_authorised", label: "Not authorised" },
];

const GMO_OPTIONS: Array<{ value: GmoStatus; label: string }> = [
  { value: "gmo_free", label: "GMO-free" },
  { value: "contains_gmo", label: "Contains GMO" },
  { value: "unknown", label: "Unknown" },
];

const REGULATORY_CATEGORIES: Array<{ value: RegulatoryCategory; label: string }> = [
  { value: "food_supplement", label: "Food supplement" },
  { value: "functional_food", label: "Functional food" },
  { value: "cosmetic", label: "Cosmetic" },
  { value: "medical_device", label: "Medical device" },
];

const DOSAGE_FORMS: Array<{ value: DosageForm; label: string }> = [
  { value: "capsule", label: "Capsule" },
  { value: "tablet", label: "Tablet" },
  { value: "softgel", label: "Softgel" },
  { value: "powder", label: "Powder" },
  { value: "liquid", label: "Liquid" },
  { value: "gummy", label: "Gummy" },
];

const CAPSULE_SIZES: CapsuleSize[] = ["000", "00", "0", "1", "2", "3", "4"];

const POWDER_TYPES: Array<{ value: PowderType; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "protein", label: "Protein" },
];

const PACKAGING_MATERIALS: Array<{ value: PackagingMaterial; label: string }> = [
  { value: "glass", label: "Glass" },
  { value: "hdpe", label: "HDPE" },
  { value: "pet", label: "PET" },
  { value: "pp", label: "PP" },
  { value: "cardboard", label: "Cardboard" },
  { value: "aluminum", label: "Aluminium" },
  { value: "multi_layer", label: "Multi-layer" },
  { value: "other", label: "Other" },
];

const RISK_LEVELS: Array<{ value: RiskLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

const LEVEL_TONE: Record<RiskLevel, "emerald" | "amber" | "destructive"> = {
  low: "emerald",
  medium: "amber",
  high: "amber",
  critical: "destructive",
};

const ANY_SENTINEL = "__any__";

// Combined state shape: identity + every sub-table's fields. Most are
// strings (form inputs) — coerced on submit.
interface FormState {
  // Identity
  name: string;
  description: string;
  item_type: ItemType;
  external_sku: string;
  barcode: string;
  stock_uom_id: number | null;
  product_family_id: number | null;
  attributes: Record<string, unknown>;
  /** Storage requirement tags — drive the cell picker filter on the
   *  receive-lot form so this item only lands in compatible cells. */
  storage_tags: string[];
  is_active: boolean;

  // Reorder points (consumable / raw_material / packaging only). Empty
  // string means "not tracked"; a numeric string enables the reorder
  // sweep on this item. target must be >= min when both are set.
  min_stock_qty: string;
  target_stock_qty: string;

  // Raw material compliance
  rm_use_as: string;
  rm_allergen_status: string;
  rm_vegan_status: string;
  rm_halal_status: string;
  rm_kosher_status: string;
  rm_organic_status: string;
  rm_novel_food_status: string;
  rm_gmo_status: string;
  rm_country_of_origin: string;
  rm_purity_pct: string;
  rm_extract_ratio: string;
  rm_overage_pct: string;
  rm_powder_water_dose_mg_per_ml: string;
  rm_shelf_life_months: string;
  rm_storage_conditions: string;
  rm_spec_document_file: ItemFile | null;
  rm_last_reviewed_at: string;
  rm_review_frequency_months: string;
  /** Allergen UUIDs this raw material contains / carries traces of.
   *  Full-replace set semantics, no per-row state. */
  rm_allergen_uuids: string[];

  // Raw material risk
  rmrisk_physical_risk_score: string;
  rmrisk_chemical_risk_score: string;
  rmrisk_biological_risk_score: string;
  rmrisk_allergen_risk_score: string;
  rmrisk_radiological_risk_score: string;
  rmrisk_fraud_vulnerability_score: string;
  rmrisk_malicious_risk_score: string;
  rmrisk_overridden_overall_level: string;
  rmrisk_override_justification: string;
  rmrisk_justification: string;
  rmrisk_required_controls: string;

  // Finished product
  fp_regulatory_category: string;
  fp_dosage_form: string;
  fp_capsule_size: string;
  fp_tablet_size_mm: string;
  fp_powder_type: string;
  fp_serving_size: string;
  fp_serving_size_uom_id: string;
  fp_servings_per_pack: string;
  fp_net_quantity: string;
  fp_net_quantity_uom_id: string;
  fp_directions_of_use: string;
  fp_suggested_dosage: string;
  fp_warnings_text: string;
  fp_appearance: string;
  fp_disintegration_spec: string;
  fp_weight_uniformity_pct: string;
  fp_shelf_life_months: string;
  fp_storage_conditions: string;
  fp_food_contact_status: string;
  fp_spec_document_file: ItemFile | null;
  fp_target_markets: string;
  fp_may_contain_allergen_uuids: string[];
  fp_may_contain_justification: string;

  // Packaging
  pkg_material: string;
  pkg_food_contact_compliant: "" | "true" | "false";
  pkg_food_contact_declaration_file: ItemFile | null;
  pkg_recyclability_code: string;
  pkg_migration_test_file: ItemFile | null;
  pkg_migration_test_expires_at: string;
}

const RISK_SCORE_FIELDS: Array<{
  key: keyof FormState;
  label: string;
  hint: string;
}> = [
  { key: "rmrisk_physical_risk_score", label: "Physical", hint: "Foreign bodies, handling contamination." },
  { key: "rmrisk_chemical_risk_score", label: "Chemical", hint: "Pesticides, heavy metals, residues." },
  { key: "rmrisk_biological_risk_score", label: "Biological", hint: "Pathogens, mycotoxins." },
  { key: "rmrisk_allergen_risk_score", label: "Allergen", hint: "Cross-contamination risk." },
  { key: "rmrisk_radiological_risk_score", label: "Radiological", hint: "Origin-region risk." },
  { key: "rmrisk_fraud_vulnerability_score", label: "Fraud (VACCP)", hint: "Adulteration / substitution risk." },
  { key: "rmrisk_malicious_risk_score", label: "Malicious (TACCP)", hint: "Deliberate harm risk." },
];

function initialFrom(item: Item | null): FormState {
  const compliance = item?.raw_material_compliance ?? null;
  const risk = item?.raw_material_risk ?? null;
  const spec = item?.finished_product_spec ?? null;
  const pkg = item?.packaging_compliance ?? null;

  return {
    name: item?.name ?? "",
    description: item?.description ?? "",
    item_type: item?.item_type ?? "raw_material",
    external_sku: item?.external_sku ?? "",
    barcode: item?.barcode ?? "",
    stock_uom_id: item?.stock_uom_id ?? null,
    product_family_id: item?.product_family_id ?? null,
    attributes: item?.attributes ?? {},
    storage_tags: item?.storage_tags ?? [],
    is_active: item?.is_active ?? true,
    min_stock_qty: item?.min_stock_qty ?? "",
    target_stock_qty: item?.target_stock_qty ?? "",

    rm_use_as: compliance?.use_as ?? "",
    rm_allergen_status: compliance?.allergen_status ?? "",
    rm_vegan_status: compliance?.vegan_status ?? "",
    rm_halal_status: compliance?.halal_status ?? "",
    rm_kosher_status: compliance?.kosher_status ?? "",
    rm_organic_status: compliance?.organic_status ?? "",
    rm_novel_food_status: compliance?.novel_food_status ?? "",
    rm_gmo_status: compliance?.gmo_status ?? "",
    rm_country_of_origin: compliance?.country_of_origin ?? "",
    rm_purity_pct: compliance?.purity_pct ?? "",
    rm_extract_ratio: compliance?.extract_ratio ?? "",
    rm_overage_pct: compliance?.overage_pct ?? "",
    rm_powder_water_dose_mg_per_ml: compliance?.powder_water_dose_mg_per_ml ?? "",
    rm_shelf_life_months: compliance?.shelf_life_months?.toString() ?? "",
    rm_storage_conditions: compliance?.storage_conditions ?? "",
    rm_spec_document_file: compliance?.spec_document_file ?? null,
    rm_last_reviewed_at: compliance?.last_reviewed_at
      ? compliance.last_reviewed_at.slice(0, 16)
      : "",
    rm_review_frequency_months: compliance?.review_frequency_months?.toString() ?? "",
    rm_allergen_uuids: (item?.allergens ?? []).map((a) => a.uuid),

    rmrisk_physical_risk_score: risk?.physical_risk_score?.toString() ?? "",
    rmrisk_chemical_risk_score: risk?.chemical_risk_score?.toString() ?? "",
    rmrisk_biological_risk_score: risk?.biological_risk_score?.toString() ?? "",
    rmrisk_allergen_risk_score: risk?.allergen_risk_score?.toString() ?? "",
    rmrisk_radiological_risk_score: risk?.radiological_risk_score?.toString() ?? "",
    rmrisk_fraud_vulnerability_score: risk?.fraud_vulnerability_score?.toString() ?? "",
    rmrisk_malicious_risk_score: risk?.malicious_risk_score?.toString() ?? "",
    rmrisk_overridden_overall_level: risk?.overridden_overall_level ?? "",
    rmrisk_override_justification: risk?.override_justification ?? "",
    rmrisk_justification: risk?.justification ?? "",
    rmrisk_required_controls: risk?.required_controls ?? "",

    fp_regulatory_category: spec?.regulatory_category ?? "",
    fp_dosage_form: spec?.dosage_form ?? "",
    fp_capsule_size: spec?.capsule_size ?? "",
    fp_tablet_size_mm: spec?.tablet_size_mm ?? "",
    fp_powder_type: spec?.powder_type ?? "",
    fp_serving_size: spec?.serving_size ?? "",
    fp_serving_size_uom_id: spec?.serving_size_uom_id?.toString() ?? "",
    fp_servings_per_pack: spec?.servings_per_pack?.toString() ?? "",
    fp_net_quantity: spec?.net_quantity ?? "",
    fp_net_quantity_uom_id: spec?.net_quantity_uom_id?.toString() ?? "",
    fp_directions_of_use: spec?.directions_of_use ?? "",
    fp_suggested_dosage: spec?.suggested_dosage ?? "",
    fp_warnings_text: spec?.warnings_text ?? "",
    fp_appearance: spec?.appearance ?? "",
    fp_disintegration_spec: spec?.disintegration_spec ?? "",
    fp_weight_uniformity_pct: spec?.weight_uniformity_pct ?? "",
    fp_shelf_life_months: spec?.shelf_life_months?.toString() ?? "",
    fp_storage_conditions: spec?.storage_conditions ?? "",
    fp_food_contact_status: spec?.food_contact_status ?? "",
    fp_spec_document_file: spec?.spec_document_file ?? null,
    fp_target_markets: (spec?.target_markets ?? []).join(", "),
    fp_may_contain_allergen_uuids: spec?.may_contain_allergens ?? [],
    fp_may_contain_justification: spec?.may_contain_justification ?? "",

    pkg_material: pkg?.material ?? "",
    pkg_food_contact_compliant:
      pkg?.food_contact_compliant === null || pkg?.food_contact_compliant === undefined
        ? ""
        : pkg.food_contact_compliant
          ? "true"
          : "false",
    pkg_food_contact_declaration_file: pkg?.food_contact_declaration_file ?? null,
    pkg_recyclability_code: pkg?.recyclability_code ?? "",
    pkg_migration_test_file: pkg?.migration_test_file ?? null,
    pkg_migration_test_expires_at: pkg?.migration_test_expires_at ?? "",
  };
}

function computeRiskLevel(state: FormState): RiskLevel | null {
  const scores = RISK_SCORE_FIELDS.map((f) => {
    const v = state[f.key];
    if (typeof v !== "string" || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }).filter((n): n is number => n !== null);
  if (scores.length === 0) return null;
  const max = Math.max(...scores);
  if (max <= 1) return "low";
  if (max === 2) return "medium";
  if (max <= 4) return "high";
  return "critical";
}

export function ItemForm({
  item,
  canEdit,
  canEditRisk,
  canApproveRisk,
  units,
  families,
  attributeDefinitions,
  allAllergens,
  storageTags,
  onSavedSuccess,
}: FormProps) {
  const router = useRouter();
  const isEdit = item !== null;
  const resource = item ? `item:${item.uuid}` : "item:new";

  useFormPresenceBeacon(resource);

  type CommitPayload =
    | { kind: "created"; uuid: string; name: string }
    | { kind: "saved"; state: FormState };

  const {
    state,
    setField,
    resetState,
    presence,
    fieldEditors,
    focusField,
    blurField,
    joinError,
    creator,
    isCreator,
    cursors,
    setCursor,
    hideCursor,
    broadcastCommit,
  } = useLiveForm<FormState>({
    resource,
    disabled: !canEdit,
    initialState: useMemo(() => initialFrom(item), [item]),
    onCommit: (raw) => {
      const msg = raw as CommitPayload | null;
      if (!msg) return;
      if (msg.kind === "created") {
        toast.success("Item created", {
          description: `${creator?.name ?? "The host"} just finalised "${msg.name}".`,
        });
        router.push("/settings/items");
      } else if (msg.kind === "saved") {
        toast.success("Saved", {
          description: `${creator?.name ?? "The host"} just saved the form.`,
        });
        setOriginal(msg.state);
        resetState(msg.state);
        if (item) invalidateAudit("item", item.id);
      }
    },
  });

  const cursorAnchorRef = useRef<HTMLDivElement | null>(null);
  const [anchorSize, setAnchorSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = cursorAnchorRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setAnchorSize({ w: rect.width, h: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => hideCursor(), [hideCursor]);

  useEffect(() => {
    if (!item) return;
    return subscribeRestore("item", item.id, (raw) => {
      const r = raw as Partial<Item> & Record<string, unknown>;
      const seed = initialFrom({
        ...(item as Item),
        ...r,
      } as Item);
      resetState(seed);
    });
  }, [item, resetState]);

  const onCursorMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = cursorAnchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setCursor(
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [setCursor],
  );

  const [original, setOriginal] = useState<FormState>(() => initialFrom(item));
  const [actionError, setActionError] = useState<ErrorResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();

  // Compliance gate state — live blockers + the transition buttons.
  // The list comes from the server payload (computed fresh each show),
  // and we shadow it with `freshBlockers` after a failed mark-ready
  // attempt so the FE shows the just-returned list immediately without
  // waiting for a refetch.
  const [complianceTransition, startComplianceTransition] = useTransition();
  const [freshBlockers, setFreshBlockers] = useState<
    import("@/lib/types").ItemComplianceBlocker[] | null
  >(null);
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertReason, setRevertReason] = useState("");

  const dirty = JSON.stringify(state) !== JSON.stringify(original);

  const visibleAttributeDefinitions = useMemo(
    () =>
      attributeDefinitions.filter(
        (a) => a.scope === state.item_type || a.scope === "item_any",
      ),
    [attributeDefinitions, state.item_type],
  );

  function setAttribute(key: string, value: unknown) {
    setField("attributes", { ...state.attributes, [key]: value });
  }

  function toggleMayContain(uuid: string, on: boolean) {
    const existing = Array.isArray(state.fp_may_contain_allergen_uuids)
      ? state.fp_may_contain_allergen_uuids
      : [];
    const next = new Set(existing);
    if (on) next.add(uuid);
    else next.delete(uuid);
    setField("fp_may_contain_allergen_uuids", [...next]);
  }

  function toggleAllergen(uuid: string, on: boolean) {
    const existing = Array.isArray(state.rm_allergen_uuids)
      ? state.rm_allergen_uuids
      : [];
    const next = new Set(existing);
    if (on) next.add(uuid);
    else next.delete(uuid);
    setField("rm_allergen_uuids", [...next]);
  }

  const previewRiskLevel = computeRiskLevel(state);
  const effectiveRiskLevel: RiskLevel | null =
    (state.rmrisk_overridden_overall_level as RiskLevel) || previewRiskLevel;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setFieldErrors({});

    // Defensive read — peers can occasionally broadcast a setField
    // for a key our local state hasn't initialised yet. Without this
    // guard the first .trim() would crash with "Cannot read
    // properties of undefined".
    const s = (key: keyof FormState): string => {
      const v = state[key];
      return typeof v === "string" ? v : "";
    };

    startTransition(async () => {
      const reordersOk =
        state.item_type === "consumable" ||
        state.item_type === "raw_material" ||
        state.item_type === "packaging";

      const itemPayload = {
        name: s("name").trim(),
        description: s("description").trim() || null,
        item_type: state.item_type,
        external_sku: s("external_sku").trim() || null,
        barcode: s("barcode").trim() || null,
        stock_uom_id: state.stock_uom_id,
        product_family_id: state.product_family_id,
        attributes: state.attributes,
        storage_tags: state.storage_tags,
        is_active: state.is_active,
        // Reorder points only meaningful for bought-in item types.
        // Send `null` on the others so a stale value from an item
        // type switch doesn't linger past the change.
        min_stock_qty: reordersOk ? s("min_stock_qty").trim() || null : null,
        target_stock_qty:
          reordersOk ? s("target_stock_qty").trim() || null : null,
      };

      const rawMaterialCompliance =
        state.item_type === "raw_material"
          ? {
              use_as: state.rm_use_as || null,
              allergen_status: state.rm_allergen_status || null,
              vegan_status: state.rm_vegan_status || null,
              halal_status: state.rm_halal_status || null,
              kosher_status: state.rm_kosher_status || null,
              organic_status: state.rm_organic_status || null,
              novel_food_status: state.rm_novel_food_status || null,
              gmo_status: state.rm_gmo_status || null,
              country_of_origin: s("rm_country_of_origin").trim() || null,
              purity_pct: s("rm_purity_pct").trim() || null,
              extract_ratio: s("rm_extract_ratio").trim() || null,
              overage_pct: s("rm_overage_pct").trim() || null,
              powder_water_dose_mg_per_ml:
                s("rm_powder_water_dose_mg_per_ml").trim() || null,
              shelf_life_months: s("rm_shelf_life_months")
                ? Number(s("rm_shelf_life_months"))
                : null,
              storage_conditions: s("rm_storage_conditions").trim() || null,
              spec_document_file_id: state.rm_spec_document_file?.id ?? null,
              last_reviewed_at: s("rm_last_reviewed_at")
                ? new Date(s("rm_last_reviewed_at")).toISOString()
                : null,
              review_frequency_months: s("rm_review_frequency_months")
                ? Number(s("rm_review_frequency_months"))
                : null,
            }
          : null;

      const rawMaterialRisk =
        state.item_type === "raw_material" && canEditRisk
          ? {
              physical_risk_score: s("rmrisk_physical_risk_score")
                ? Number(s("rmrisk_physical_risk_score"))
                : null,
              chemical_risk_score: s("rmrisk_chemical_risk_score")
                ? Number(s("rmrisk_chemical_risk_score"))
                : null,
              biological_risk_score: s("rmrisk_biological_risk_score")
                ? Number(s("rmrisk_biological_risk_score"))
                : null,
              allergen_risk_score: s("rmrisk_allergen_risk_score")
                ? Number(s("rmrisk_allergen_risk_score"))
                : null,
              radiological_risk_score: s("rmrisk_radiological_risk_score")
                ? Number(s("rmrisk_radiological_risk_score"))
                : null,
              fraud_vulnerability_score: s("rmrisk_fraud_vulnerability_score")
                ? Number(s("rmrisk_fraud_vulnerability_score"))
                : null,
              malicious_risk_score: s("rmrisk_malicious_risk_score")
                ? Number(s("rmrisk_malicious_risk_score"))
                : null,
              overridden_overall_level:
                s("rmrisk_overridden_overall_level") || null,
              override_justification:
                s("rmrisk_override_justification").trim() || null,
              justification: s("rmrisk_justification").trim() || null,
              required_controls: s("rmrisk_required_controls").trim() || null,
            }
          : null;

      const finishedProductSpec =
        state.item_type === "finished_product"
          ? {
              regulatory_category: s("fp_regulatory_category") || null,
              dosage_form: s("fp_dosage_form") || null,
              capsule_size: s("fp_capsule_size") || null,
              tablet_size_mm: s("fp_tablet_size_mm").trim() || null,
              powder_type: s("fp_powder_type") || null,
              serving_size: s("fp_serving_size").trim() || null,
              serving_size_uom_id: s("fp_serving_size_uom_id")
                ? Number(s("fp_serving_size_uom_id"))
                : null,
              servings_per_pack: s("fp_servings_per_pack")
                ? Number(s("fp_servings_per_pack"))
                : null,
              net_quantity: s("fp_net_quantity").trim() || null,
              net_quantity_uom_id: s("fp_net_quantity_uom_id")
                ? Number(s("fp_net_quantity_uom_id"))
                : null,
              directions_of_use: s("fp_directions_of_use").trim() || null,
              suggested_dosage: s("fp_suggested_dosage").trim() || null,
              warnings_text: s("fp_warnings_text").trim() || null,
              appearance: s("fp_appearance").trim() || null,
              disintegration_spec: s("fp_disintegration_spec").trim() || null,
              weight_uniformity_pct:
                s("fp_weight_uniformity_pct").trim() || null,
              shelf_life_months: s("fp_shelf_life_months")
                ? Number(s("fp_shelf_life_months"))
                : null,
              storage_conditions: s("fp_storage_conditions").trim() || null,
              food_contact_status: s("fp_food_contact_status").trim() || null,
              spec_document_file_id: state.fp_spec_document_file?.id ?? null,
              target_markets: s("fp_target_markets")
                .split(/[,\s]+/)
                .map((x) => x.trim().toUpperCase())
                .filter((x) => x.length > 0),
              may_contain_allergens: Array.isArray(
                state.fp_may_contain_allergen_uuids,
              )
                ? state.fp_may_contain_allergen_uuids
                : [],
              may_contain_justification:
                s("fp_may_contain_justification").trim() || null,
            }
          : null;

      const packagingCompliance =
        state.item_type === "packaging"
          ? {
              material: s("pkg_material") || null,
              food_contact_compliant:
                state.pkg_food_contact_compliant === "" ||
                state.pkg_food_contact_compliant == null
                  ? null
                  : state.pkg_food_contact_compliant === "true",
              food_contact_declaration_file_id:
                state.pkg_food_contact_declaration_file?.id ?? null,
              recyclability_code: s("pkg_recyclability_code").trim() || null,
              migration_test_file_id:
                state.pkg_migration_test_file?.id ?? null,
              migration_test_expires_at:
                s("pkg_migration_test_expires_at") || null,
            }
          : null;

      // Full-replace allergen set — only meaningful on raw materials.
      // Omit on other types so the backend skips the M:N write.
      const allergenUuids =
        state.item_type === "raw_material" &&
        Array.isArray(state.rm_allergen_uuids)
          ? state.rm_allergen_uuids
          : null;

      let res;
      if (isEdit) {
        res = await updateItemFullAction(item!.uuid, {
          item: itemPayload,
          raw_material_compliance: rawMaterialCompliance,
          raw_material_risk: rawMaterialRisk,
          finished_product_spec: finishedProductSpec,
          packaging_compliance: packagingCompliance,
          allergen_uuids: allergenUuids,
        });
      } else {
        // New items get created via the simple create endpoint —
        // sub-tables need an existing item_id. After create, redirect
        // to the edit page so the user can fill in sub-sections.
        res = await createItemAction(itemPayload);
      }

      if (!res.ok) {
        setFieldErrors(res.fields ?? {});
        setActionError(res);
        return;
      }

      toast.success(isEdit ? "Item saved" : "Item created");
      setOriginal(state);
      invalidateAudit("item", res.item.id);

      if (isEdit) {
        broadcastCommit({ kind: "saved", state });
        onSavedSuccess?.();
        router.refresh();
      } else {
        broadcastCommit({
          kind: "created",
          uuid: res.item.uuid,
          name: res.item.name,
        });
        router.push(`/settings/items/${res.item.uuid}`);
      }
    });
  }

  function onReset() {
    resetState(original);
    setFieldErrors({});
    setActionError(null);
  }

  function onDelete() {
    if (!item) return;
    if (
      !window.confirm(
        `Delete "${item.name}"? Stock movements and BOMs referencing this item will lose the reference.`,
      )
    ) {
      return;
    }
    setActionError(null);
    startTransition(async () => {
      const res = await deleteItemAction(item.uuid);
      if (!res.ok) {
        setActionError(res);
        return;
      }
      toast.success("Item removed");
      router.push("/settings/items");
      router.refresh();
    });
  }

  if (joinError) {
    return <JoinErrorCard error={joinError} isEdit={isEdit} />;
  }

  const isRawMaterial = state.item_type === "raw_material";
  const isFinishedProduct = state.item_type === "finished_product";
  const isPackaging = state.item_type === "packaging";

  return (
    <div
      ref={cursorAnchorRef}
      onMouseMove={canEdit ? onCursorMove : undefined}
      onMouseLeave={canEdit ? hideCursor : undefined}
      className="relative rounded-lg border border-border/60 bg-background p-5"
    >
      <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-lg">
        {Object.entries(cursors).map(([id, cursor]) => (
          <RemoteCursor
            key={id}
            cursor={cursor}
            anchorWidth={anchorSize.w}
            anchorHeight={anchorSize.h}
          />
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {isEdit && item?.code ? (
            <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
              <span className="font-medium text-muted-foreground">Code</span>
              <span className="font-mono">{item.code}</span>
              <span className="text-muted-foreground/70">
                — auto-generated from your Numbering format
              </span>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <CollabAvatars peers={presence} />
            {!canEdit && (
              <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                <LockKeyhole className="size-3" />
                Read-only
              </span>
            )}
          </div>
        </div>

        {isEdit && item && (
          <ComplianceGateBanner
            item={item}
            canEdit={canEdit}
            freshBlockers={freshBlockers}
            pending={complianceTransition}
            revertOpen={revertOpen}
            revertReason={revertReason}
            onMarkReady={() => {
              setActionError(null);
              startComplianceTransition(async () => {
                const res = await markItemReadyAction(item.uuid);
                if (res.ok) {
                  setFreshBlockers([]);
                  toast.success("Marked ready for use");
                  router.refresh();
                } else {
                  if (res.blockers) setFreshBlockers(res.blockers);
                  setActionError(res);
                  toast.error(res.detail);
                }
              });
            }}
            onOpenRevert={() => {
              setRevertReason("");
              setRevertOpen(true);
            }}
            onCloseRevert={() => setRevertOpen(false)}
            onChangeRevertReason={setRevertReason}
            onConfirmRevert={() => {
              if (!revertReason.trim()) return;
              setActionError(null);
              startComplianceTransition(async () => {
                const res = await revertItemToDraftAction(
                  item.uuid,
                  revertReason.trim(),
                );
                if (res.ok) {
                  setRevertOpen(false);
                  setRevertReason("");
                  toast.success("Reverted to draft");
                  router.refresh();
                } else {
                  setActionError(res);
                  toast.error(res.detail);
                }
              });
            }}
          />
        )}

        <fieldset disabled={!canEdit || pending} className="space-y-8">
          {/* Identity */}
          <h3 className="text-sm font-semibold">Identity</h3>
          <Grid>
            <FieldRow label="Name" htmlFor="i-name" required>
              <Input
                id="i-name"
                value={state.name}
                onChange={(e) => setField("name", e.target.value)}
                onFocus={() => focusField("name")}
                onBlur={() => blurField("name")}
                placeholder="Vitamin D3 Powder"
                maxLength={200}
                required
              />
              <FieldEditingIndicator peer={fieldEditors.name} />
              <FieldError messages={fieldErrors["item.name"]} />
            </FieldRow>

            <FieldRow label="Type" required>
              <Select
                value={state.item_type}
                onValueChange={(v) => setField("item_type", v as ItemType)}
              >
                <SelectTrigger
                  onFocus={() => focusField("item_type")}
                  onBlur={() => blurField("item_type")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <div className="flex flex-col">
                        <span>{o.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {o.desc}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldEditingIndicator peer={fieldEditors.item_type} />
              <FieldError messages={fieldErrors["item.item_type"]} />
            </FieldRow>

            <FieldRow label="External SKU" htmlFor="i-ext-sku">
              <Input
                id="i-ext-sku"
                value={state.external_sku}
                onChange={(e) => setField("external_sku", e.target.value)}
                onFocus={() => focusField("external_sku")}
                onBlur={() => blurField("external_sku")}
                placeholder="Supplier or customer SKU"
                maxLength={80}
                className="font-mono"
              />
              <FieldEditingIndicator peer={fieldEditors.external_sku} />
              <FieldError messages={fieldErrors["item.external_sku"]} />
            </FieldRow>

            <FieldRow label="Barcode" htmlFor="i-barcode">
              <Input
                id="i-barcode"
                value={state.barcode}
                onChange={(e) => setField("barcode", e.target.value)}
                onFocus={() => focusField("barcode")}
                onBlur={() => blurField("barcode")}
                placeholder="GTIN-13 / GTIN-14"
                maxLength={24}
                className="font-mono"
              />
              <FieldEditingIndicator peer={fieldEditors.barcode} />
              <FieldError messages={fieldErrors["item.barcode"]} />
            </FieldRow>

            <FieldRow label="Stock unit">
              <Select
                value={state.stock_uom_id === null ? "" : String(state.stock_uom_id)}
                onValueChange={(v) =>
                  setField("stock_uom_id", v === "" ? null : Number(v))
                }
              >
                <SelectTrigger
                  onFocus={() => focusField("stock_uom_id")}
                  onBlur={() => blurField("stock_uom_id")}
                >
                  <SelectValue placeholder="Pick a stock unit" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} ({u.symbol})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldEditingIndicator peer={fieldEditors.stock_uom_id} />
              <FieldError messages={fieldErrors["item.stock_uom_id"]} />
            </FieldRow>

            <FieldRow label="Product family">
              <Select
                value={
                  state.product_family_id === null
                    ? ""
                    : String(state.product_family_id)
                }
                onValueChange={(v) =>
                  setField("product_family_id", v === "" ? null : Number(v))
                }
              >
                <SelectTrigger
                  onFocus={() => focusField("product_family_id")}
                  onBlur={() => blurField("product_family_id")}
                >
                  <SelectValue placeholder="Optional — group variant SKUs" />
                </SelectTrigger>
                <SelectContent>
                  {families.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldEditingIndicator peer={fieldEditors.product_family_id} />
              <FieldError messages={fieldErrors["item.product_family_id"]} />
            </FieldRow>
          </Grid>

          <FieldRow label="Description" htmlFor="i-desc">
            <Textarea
              id="i-desc"
              value={state.description}
              onChange={(e) => setField("description", e.target.value)}
              onFocus={() => focusField("description")}
              onBlur={() => blurField("description")}
              rows={3}
              placeholder="Plain-English description, internal use."
            />
            <FieldEditingIndicator peer={fieldEditors.description} />
            <FieldError messages={fieldErrors["item.description"]} />
          </FieldRow>

          <FieldRow label="Storage tags">
            <TagPicker
              value={state.storage_tags}
              known={storageTags}
              kind="cell"
              label=""
              help="Cells whose effective tags (location + cell) cover every tag listed here will appear in this item's destination picker on the receive form. Leave empty to allow any cell."
              readOnly={!canEdit}
              onCommit={(tags) => setField("storage_tags", tags)}
            />
            <FieldError messages={fieldErrors["item.storage_tags"]} />
          </FieldRow>

          <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={state.is_active}
              onCheckedChange={(c) => setField("is_active", Boolean(c))}
            />
            <span className="flex-1">
              <span className="font-medium">Active</span>
              <span className="block text-xs text-muted-foreground">
                Inactive items stay in history but disappear from pickers and
                stock-move forms.
              </span>
            </span>
            <FieldEditingIndicator peer={fieldEditors.is_active} />
          </label>

          {/* Reorder points — bought-in item types only. Setting both
              enables the coverage sweep in procurement's suggestion
              endpoint; leave blank to opt this item out. */}
          {(state.item_type === "consumable" ||
            state.item_type === "raw_material" ||
            state.item_type === "packaging") && (
            <>
              <SectionHeader
                title="Reorder points"
                hint="When on-hand + in-flight PO qty drops below min, procurement gets a task to raise a PO. Target is the order-up-to level."
              />
              <Grid>
                <FieldRow label="Min stock qty">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={state.min_stock_qty}
                    onChange={(e) => setField("min_stock_qty", e.target.value)}
                    onFocus={() => focusField("min_stock_qty")}
                    onBlur={() => blurField("min_stock_qty")}
                    placeholder="e.g. 50"
                    disabled={!canEdit}
                    className="font-mono"
                  />
                  <FieldError messages={fieldErrors["item.min_stock_qty"]} />
                  <FieldEditingIndicator peer={fieldEditors.min_stock_qty} />
                </FieldRow>
                <FieldRow label="Target stock qty">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={state.target_stock_qty}
                    onChange={(e) =>
                      setField("target_stock_qty", e.target.value)
                    }
                    onFocus={() => focusField("target_stock_qty")}
                    onBlur={() => blurField("target_stock_qty")}
                    placeholder="e.g. 200"
                    disabled={!canEdit}
                    className="font-mono"
                  />
                  <FieldError
                    messages={fieldErrors["item.target_stock_qty"]}
                  />
                  <FieldEditingIndicator peer={fieldEditors.target_stock_qty} />
                </FieldRow>
              </Grid>
            </>
          )}

          {visibleAttributeDefinitions.length > 0 && (
            <>
              <SectionHeader
                title="Custom attributes"
                hint={`Admin-defined fields for ${ITEM_TYPE_OPTIONS.find((o) => o.value === state.item_type)?.label.toLowerCase() ?? "this type"}.`}
              />
              <Grid>
                {visibleAttributeDefinitions.map((def_) => (
                  <DynamicAttributeRow
                    key={def_.uuid}
                    def_={def_}
                    value={state.attributes[def_.key]}
                    onChange={(v) => setAttribute(def_.key, v)}
                    onFocus={() => focusField(`attr:${def_.key}`)}
                    onBlur={() => blurField(`attr:${def_.key}`)}
                    editor={fieldEditors[`attr:${def_.key}`]}
                  />
                ))}
              </Grid>
            </>
          )}

          {/* Raw material compliance + risk */}
          {isRawMaterial && isEdit && (
            <>
              <SectionHeader
                title="Regulatory compliance"
                hint="Dietary, regulatory, sourcing, review cadence."
              />
              <Grid>
                <EnumLiveRow label="Used as" fieldKey="rm_use_as" value={state.rm_use_as} options={USE_AS_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_use_as"]} errors={fieldErrors["raw_material_compliance.use_as"]} />
                <EnumLiveRow label="Allergen status" fieldKey="rm_allergen_status" value={state.rm_allergen_status} options={ALLERGEN_STATUS_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_allergen_status"]} errors={fieldErrors["raw_material_compliance.allergen_status"]} />
                <EnumLiveRow label="Vegan" fieldKey="rm_vegan_status" value={state.rm_vegan_status} options={VEGAN_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_vegan_status"]} errors={fieldErrors["raw_material_compliance.vegan_status"]} />
                <EnumLiveRow label="Halal" fieldKey="rm_halal_status" value={state.rm_halal_status} options={TRI_STATUS_HALAL} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_halal_status"]} errors={fieldErrors["raw_material_compliance.halal_status"]} />
                <EnumLiveRow label="Kosher" fieldKey="rm_kosher_status" value={state.rm_kosher_status} options={TRI_STATUS_KOSHER} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_kosher_status"]} errors={fieldErrors["raw_material_compliance.kosher_status"]} />
                <EnumLiveRow label="Organic" fieldKey="rm_organic_status" value={state.rm_organic_status} options={ORGANIC_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_organic_status"]} errors={fieldErrors["raw_material_compliance.organic_status"]} />
                <EnumLiveRow label="Novel food" fieldKey="rm_novel_food_status" value={state.rm_novel_food_status} options={NOVEL_FOOD_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_novel_food_status"]} errors={fieldErrors["raw_material_compliance.novel_food_status"]} />
                <EnumLiveRow label="GMO status" fieldKey="rm_gmo_status" value={state.rm_gmo_status} options={GMO_OPTIONS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_gmo_status"]} errors={fieldErrors["raw_material_compliance.gmo_status"]} />
                <TextLiveRow label="Country of origin" fieldKey="rm_country_of_origin" value={state.rm_country_of_origin} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_country_of_origin"]} errors={fieldErrors["raw_material_compliance.country_of_origin"]} placeholder="GB" maxLength={2} mono hint="ISO 3166-1 alpha-2." transform={(v) => v.toUpperCase()} />
                <TextLiveRow label="Purity (%)" fieldKey="rm_purity_pct" value={state.rm_purity_pct} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_purity_pct"]} errors={fieldErrors["raw_material_compliance.purity_pct"]} type="number" step="0.01" mono />
                <TextLiveRow label="Extract ratio" fieldKey="rm_extract_ratio" value={state.rm_extract_ratio} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_extract_ratio"]} errors={fieldErrors["raw_material_compliance.extract_ratio"]} placeholder="4:1" maxLength={20} />
                <TextLiveRow label="Overage (%)" fieldKey="rm_overage_pct" value={state.rm_overage_pct} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_overage_pct"]} errors={fieldErrors["raw_material_compliance.overage_pct"]} type="number" step="0.01" mono hint="Manufacturing tolerance." />
                <TextLiveRow label="Powder water dose (mg/mL)" fieldKey="rm_powder_water_dose_mg_per_ml" value={state.rm_powder_water_dose_mg_per_ml} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_powder_water_dose_mg_per_ml"]} errors={fieldErrors["raw_material_compliance.powder_water_dose_mg_per_ml"]} type="number" step="0.001" mono hint="For powder acidity regulators only." />
                <TextLiveRow label="Shelf life (months)" fieldKey="rm_shelf_life_months" value={state.rm_shelf_life_months} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["rm_shelf_life_months"]} errors={fieldErrors["raw_material_compliance.shelf_life_months"]} type="number" />
              </Grid>
              <FieldRow label="Storage conditions">
                <Textarea value={state.rm_storage_conditions} onChange={(e) => setField("rm_storage_conditions", e.target.value)} onFocus={() => focusField("rm_storage_conditions")} onBlur={() => blurField("rm_storage_conditions")} rows={2} placeholder="Store below 25 °C, away from direct light." />
                <FieldEditingIndicator peer={fieldEditors["rm_storage_conditions"]} />
                <FieldError messages={fieldErrors["raw_material_compliance.storage_conditions"]} />
              </FieldRow>
              <FieldRow label="Spec document">
                <ItemFileUploadField
                  itemUuid={item?.uuid ?? null}
                  kind="spec_sheet"
                  file={state.rm_spec_document_file}
                  onChange={(f) => setField("rm_spec_document_file", f)}
                  disabled={!canEdit}
                  fieldKey="rm_spec_document_file"
                  focusField={focusField}
                  blurField={blurField}
                  editor={fieldEditors["rm_spec_document_file"]}
                />
                <FieldError messages={fieldErrors["raw_material_compliance.spec_document_file_id"]} />
              </FieldRow>
              <Grid>
                <FieldRow label="Last reviewed at">
                  <Input type="datetime-local" value={state.rm_last_reviewed_at} onChange={(e) => setField("rm_last_reviewed_at", e.target.value)} onFocus={() => focusField("rm_last_reviewed_at")} onBlur={() => blurField("rm_last_reviewed_at")} />
                  <FieldEditingIndicator peer={fieldEditors["rm_last_reviewed_at"]} />
                  <FieldError messages={fieldErrors["raw_material_compliance.last_reviewed_at"]} />
                </FieldRow>
                <FieldRow label="Review frequency (months)" hint="Drives the review-due queue.">
                  <Input type="number" value={state.rm_review_frequency_months} onChange={(e) => setField("rm_review_frequency_months", e.target.value)} onFocus={() => focusField("rm_review_frequency_months")} onBlur={() => blurField("rm_review_frequency_months")} />
                  <FieldEditingIndicator peer={fieldEditors["rm_review_frequency_months"]} />
                  <FieldError messages={fieldErrors["raw_material_compliance.review_frequency_months"]} />
                </FieldRow>
              </Grid>

              {/* Allergens (EU FIC Annex II) — set semantics, full
                  replace on save. Lives in the mega-form so a peer's
                  tick syncs in real time. */}
              <SectionHeader
                title="Allergens (EU FIC Annex II)"
                hint="Tick every allergen this raw material contains or carries traces of. Drives label declarations and the cross-contamination matrix."
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allAllergens.map((a) => {
                  const selected =
                    Array.isArray(state.rm_allergen_uuids) &&
                    state.rm_allergen_uuids.includes(a.uuid);
                  return (
                    <label
                      key={a.uuid}
                      className="relative flex cursor-pointer items-start gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-sm hover:bg-muted/30"
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(c) =>
                          toggleAllergen(a.uuid, Boolean(c))
                        }
                        onFocus={() => focusField(`rm_allergen:${a.key}`)}
                        onBlur={() => blurField(`rm_allergen:${a.key}`)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-tight">
                          {a.label}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground">
                          {a.key}
                        </span>
                      </span>
                      <FieldEditingIndicator
                        peer={fieldEditors[`rm_allergen:${a.key}`]}
                      />
                    </label>
                  );
                })}
              </div>

              {canEditRisk && (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/40 pt-6">
                    <div className="space-y-0.5">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <ShieldAlert className="size-4 text-muted-foreground" />
                        Risk assessment
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        TACCP / VACCP / HACCP scorecard. Each component is 0 (none) to 5 (critical). The overall level is the max.
                      </p>
                    </div>
                    {effectiveRiskLevel && (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Overall level</span>
                        <Badge tone={LEVEL_TONE[effectiveRiskLevel]}>{effectiveRiskLevel}</Badge>
                        {state.rmrisk_overridden_overall_level && previewRiskLevel && (
                          <span className="text-[10px] text-muted-foreground">overrides computed {previewRiskLevel}</span>
                        )}
                      </div>
                    )}
                  </div>
                  <Grid>
                    {RISK_SCORE_FIELDS.map((f) => (
                      <FieldRow key={f.key} label={f.label} hint={f.hint}>
                        <Input type="number" min={0} max={5} inputMode="numeric" value={String(state[f.key] ?? "")} onChange={(e) => setField(f.key, e.target.value as never)} onFocus={() => focusField(f.key as string)} onBlur={() => blurField(f.key as string)} placeholder="0 – 5" className="font-mono" />
                        <FieldEditingIndicator peer={fieldEditors[f.key as string]} />
                        <FieldError messages={fieldErrors[`raw_material_risk.${(f.key as string).replace(/^rmrisk_/, "")}`]} />
                      </FieldRow>
                    ))}
                  </Grid>
                  <FieldRow label="Justification (why these scores)">
                    <Textarea value={state.rmrisk_justification} onChange={(e) => setField("rmrisk_justification", e.target.value)} onFocus={() => focusField("rmrisk_justification")} onBlur={() => blurField("rmrisk_justification")} rows={3} />
                    <FieldEditingIndicator peer={fieldEditors["rmrisk_justification"]} />
                    <FieldError messages={fieldErrors["raw_material_risk.justification"]} />
                  </FieldRow>
                  <FieldRow label="Required controls / mitigations">
                    <Textarea value={state.rmrisk_required_controls} onChange={(e) => setField("rmrisk_required_controls", e.target.value)} onFocus={() => focusField("rmrisk_required_controls")} onBlur={() => blurField("rmrisk_required_controls")} rows={3} />
                    <FieldEditingIndicator peer={fieldEditors["rmrisk_required_controls"]} />
                    <FieldError messages={fieldErrors["raw_material_risk.required_controls"]} />
                  </FieldRow>
                  {canApproveRisk && (
                    <div className="space-y-3 rounded-md border border-border/40 bg-muted/20 p-4">
                      <div>
                        <h4 className="text-sm font-semibold">Override</h4>
                        <p className="text-xs text-muted-foreground">Set a different overall level if expert judgment differs. Required when overriding.</p>
                      </div>
                      <Grid>
                        <FieldRow label="Override level">
                          <Select value={state.rmrisk_overridden_overall_level === "" ? ANY_SENTINEL : state.rmrisk_overridden_overall_level} onValueChange={(v) => setField("rmrisk_overridden_overall_level", v === ANY_SENTINEL ? "" : v)}>
                            <SelectTrigger onFocus={() => focusField("rmrisk_overridden_overall_level")} onBlur={() => blurField("rmrisk_overridden_overall_level")}>
                              <SelectValue placeholder="No override" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={ANY_SENTINEL}>— No override —</SelectItem>
                              {RISK_LEVELS.map((l) => (
                                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FieldEditingIndicator peer={fieldEditors["rmrisk_overridden_overall_level"]} />
                          <FieldError messages={fieldErrors["raw_material_risk.overridden_overall_level"]} />
                        </FieldRow>
                        <FieldRow label="Override justification">
                          <Textarea value={state.rmrisk_override_justification} onChange={(e) => setField("rmrisk_override_justification", e.target.value)} onFocus={() => focusField("rmrisk_override_justification")} onBlur={() => blurField("rmrisk_override_justification")} rows={2} placeholder="Required when overriding." />
                          <FieldEditingIndicator peer={fieldEditors["rmrisk_override_justification"]} />
                          <FieldError messages={fieldErrors["raw_material_risk.override_justification"]} />
                        </FieldRow>
                      </Grid>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* Finished product spec */}
          {isFinishedProduct && isEdit && (
            <>
              <SectionHeader title="Finished-product spec" />
              <Grid>
                <EnumLiveRow label="Regulatory category" fieldKey="fp_regulatory_category" value={state.fp_regulatory_category} options={REGULATORY_CATEGORIES} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_regulatory_category"]} errors={fieldErrors["finished_product_spec.regulatory_category"]} />
                <EnumLiveRow label="Dosage form" fieldKey="fp_dosage_form" value={state.fp_dosage_form} options={DOSAGE_FORMS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_dosage_form"]} errors={fieldErrors["finished_product_spec.dosage_form"]} />
                {state.fp_dosage_form === "capsule" && (
                  <EnumLiveRow label="Capsule size" fieldKey="fp_capsule_size" value={state.fp_capsule_size} options={CAPSULE_SIZES.map((s) => ({ value: s, label: s }))} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_capsule_size"]} errors={fieldErrors["finished_product_spec.capsule_size"]} />
                )}
                {state.fp_dosage_form === "tablet" && (
                  <TextLiveRow label="Tablet size (mm)" fieldKey="fp_tablet_size_mm" value={state.fp_tablet_size_mm} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_tablet_size_mm"]} errors={fieldErrors["finished_product_spec.tablet_size_mm"]} type="number" step="0.01" mono />
                )}
                {state.fp_dosage_form === "powder" && (
                  <EnumLiveRow label="Powder type" fieldKey="fp_powder_type" value={state.fp_powder_type} options={POWDER_TYPES} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_powder_type"]} errors={fieldErrors["finished_product_spec.powder_type"]} />
                )}
                <TextLiveRow label="Serving size" fieldKey="fp_serving_size" value={state.fp_serving_size} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_serving_size"]} errors={fieldErrors["finished_product_spec.serving_size"]} type="number" step="0.001" mono />
                <UnitPickerLive label="Serving size unit" fieldKey="fp_serving_size_uom_id" value={state.fp_serving_size_uom_id} units={units} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_serving_size_uom_id"]} errors={fieldErrors["finished_product_spec.serving_size_uom_id"]} />
                <TextLiveRow label="Servings per pack" fieldKey="fp_servings_per_pack" value={state.fp_servings_per_pack} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_servings_per_pack"]} errors={fieldErrors["finished_product_spec.servings_per_pack"]} type="number" />
                <TextLiveRow label="Net quantity" fieldKey="fp_net_quantity" value={state.fp_net_quantity} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_net_quantity"]} errors={fieldErrors["finished_product_spec.net_quantity"]} type="number" step="0.001" mono />
                <UnitPickerLive label="Net quantity unit" fieldKey="fp_net_quantity_uom_id" value={state.fp_net_quantity_uom_id} units={units} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_net_quantity_uom_id"]} errors={fieldErrors["finished_product_spec.net_quantity_uom_id"]} />
                <TextLiveRow label="Weight uniformity (%)" fieldKey="fp_weight_uniformity_pct" value={state.fp_weight_uniformity_pct} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_weight_uniformity_pct"]} errors={fieldErrors["finished_product_spec.weight_uniformity_pct"]} type="number" step="0.01" mono />
                <TextLiveRow label="Shelf life (months)" fieldKey="fp_shelf_life_months" value={state.fp_shelf_life_months} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["fp_shelf_life_months"]} errors={fieldErrors["finished_product_spec.shelf_life_months"]} type="number" />
              </Grid>
              <FieldRow label="Directions of use">
                <Textarea value={state.fp_directions_of_use} onChange={(e) => setField("fp_directions_of_use", e.target.value)} onFocus={() => focusField("fp_directions_of_use")} onBlur={() => blurField("fp_directions_of_use")} rows={2} />
                <FieldEditingIndicator peer={fieldEditors["fp_directions_of_use"]} />
                <FieldError messages={fieldErrors["finished_product_spec.directions_of_use"]} />
              </FieldRow>
              <FieldRow label="Suggested dosage">
                <Textarea value={state.fp_suggested_dosage} onChange={(e) => setField("fp_suggested_dosage", e.target.value)} onFocus={() => focusField("fp_suggested_dosage")} onBlur={() => blurField("fp_suggested_dosage")} rows={2} />
                <FieldEditingIndicator peer={fieldEditors["fp_suggested_dosage"]} />
                <FieldError messages={fieldErrors["finished_product_spec.suggested_dosage"]} />
              </FieldRow>
              <FieldRow label="Warnings">
                <Textarea value={state.fp_warnings_text} onChange={(e) => setField("fp_warnings_text", e.target.value)} onFocus={() => focusField("fp_warnings_text")} onBlur={() => blurField("fp_warnings_text")} rows={2} />
                <FieldEditingIndicator peer={fieldEditors["fp_warnings_text"]} />
                <FieldError messages={fieldErrors["finished_product_spec.warnings_text"]} />
              </FieldRow>
              <FieldRow label="Appearance">
                <Textarea value={state.fp_appearance} onChange={(e) => setField("fp_appearance", e.target.value)} onFocus={() => focusField("fp_appearance")} onBlur={() => blurField("fp_appearance")} rows={2} placeholder="Off-white powder, neutral odour…" />
                <FieldEditingIndicator peer={fieldEditors["fp_appearance"]} />
                <FieldError messages={fieldErrors["finished_product_spec.appearance"]} />
              </FieldRow>
              <Grid>
                <FieldRow label="Disintegration spec">
                  <Input value={state.fp_disintegration_spec} onChange={(e) => setField("fp_disintegration_spec", e.target.value)} onFocus={() => focusField("fp_disintegration_spec")} onBlur={() => blurField("fp_disintegration_spec")} placeholder="≤ 30 min in water at 37 °C" />
                  <FieldEditingIndicator peer={fieldEditors["fp_disintegration_spec"]} />
                  <FieldError messages={fieldErrors["finished_product_spec.disintegration_spec"]} />
                </FieldRow>
                <FieldRow label="Storage conditions">
                  <Input value={state.fp_storage_conditions} onChange={(e) => setField("fp_storage_conditions", e.target.value)} onFocus={() => focusField("fp_storage_conditions")} onBlur={() => blurField("fp_storage_conditions")} />
                  <FieldEditingIndicator peer={fieldEditors["fp_storage_conditions"]} />
                  <FieldError messages={fieldErrors["finished_product_spec.storage_conditions"]} />
                </FieldRow>
                <FieldRow label="Food contact status">
                  <Input value={state.fp_food_contact_status} onChange={(e) => setField("fp_food_contact_status", e.target.value)} onFocus={() => focusField("fp_food_contact_status")} onBlur={() => blurField("fp_food_contact_status")} />
                  <FieldEditingIndicator peer={fieldEditors["fp_food_contact_status"]} />
                  <FieldError messages={fieldErrors["finished_product_spec.food_contact_status"]} />
                </FieldRow>
                <FieldRow label="Target markets" hint="Comma-separated ISO 3166-1 alpha-2 codes.">
                  <Input value={state.fp_target_markets} onChange={(e) => setField("fp_target_markets", e.target.value.toUpperCase())} onFocus={() => focusField("fp_target_markets")} onBlur={() => blurField("fp_target_markets")} placeholder="GB, US, DE" className="font-mono" />
                  <FieldEditingIndicator peer={fieldEditors["fp_target_markets"]} />
                  <FieldError messages={fieldErrors["finished_product_spec.target_markets"]} />
                </FieldRow>
                <FieldRow label="Spec document">
                  <ItemFileUploadField
                    itemUuid={item?.uuid ?? null}
                    kind="spec_sheet"
                    file={state.fp_spec_document_file}
                    onChange={(f) => setField("fp_spec_document_file", f)}
                    disabled={!canEdit}
                    fieldKey="fp_spec_document_file"
                    focusField={focusField}
                    blurField={blurField}
                    editor={fieldEditors["fp_spec_document_file"]}
                  />
                  <FieldError messages={fieldErrors["finished_product_spec.spec_document_file_id"]} />
                </FieldRow>
              </Grid>

              <SectionHeader title="May-contain declaration" hint="Cross-contamination warnings — regulator requires the reason." />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allAllergens.map((a) => (
                  <label key={a.uuid} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2 text-sm hover:bg-muted/30">
                    <Checkbox checked={Array.isArray(state.fp_may_contain_allergen_uuids) && state.fp_may_contain_allergen_uuids.includes(a.uuid)} onCheckedChange={(c) => toggleMayContain(a.uuid, Boolean(c))} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-tight">{a.label}</span>
                      <span className="block font-mono text-[10px] text-muted-foreground">{a.key}</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldRow label="Why this warning is needed">
                <Textarea value={state.fp_may_contain_justification} onChange={(e) => setField("fp_may_contain_justification", e.target.value)} onFocus={() => focusField("fp_may_contain_justification")} onBlur={() => blurField("fp_may_contain_justification")} rows={3} placeholder="Shared line / supplier risk / etc." />
                <FieldEditingIndicator peer={fieldEditors["fp_may_contain_justification"]} />
                <FieldError messages={fieldErrors["finished_product_spec.may_contain_justification"]} />
              </FieldRow>
            </>
          )}

          {/* Packaging */}
          {isPackaging && isEdit && (
            <>
              <SectionHeader title="Packaging compliance" />
              <Grid>
                <EnumLiveRow label="Material" fieldKey="pkg_material" value={state.pkg_material} options={PACKAGING_MATERIALS} setField={setField} focusField={focusField} blurField={blurField} editor={fieldEditors["pkg_material"]} errors={fieldErrors["packaging_compliance.material"]} />
                <FieldRow label="Recyclability code">
                  <Input value={state.pkg_recyclability_code} onChange={(e) => setField("pkg_recyclability_code", e.target.value)} onFocus={() => focusField("pkg_recyclability_code")} onBlur={() => blurField("pkg_recyclability_code")} placeholder="2 (HDPE), 5 (PP)…" className="font-mono" />
                  <FieldEditingIndicator peer={fieldEditors["pkg_recyclability_code"]} />
                  <FieldError messages={fieldErrors["packaging_compliance.recyclability_code"]} />
                </FieldRow>
              </Grid>
              <label className="relative flex items-start gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
                <Checkbox checked={state.pkg_food_contact_compliant === "true"} onCheckedChange={(c) => setField("pkg_food_contact_compliant", (c ? "true" : "false") as "true" | "false")} />
                <span className="flex-1">
                  <span className="font-medium">Food-contact compliant</span>
                  <span className="block text-xs text-muted-foreground">EU 1935/2004 / FDA 21 CFR.</span>
                </span>
                <FieldEditingIndicator peer={fieldEditors["pkg_food_contact_compliant"]} />
              </label>
              <FieldRow label="Food-contact declaration">
                <ItemFileUploadField
                  itemUuid={item?.uuid ?? null}
                  kind="food_contact_declaration"
                  file={state.pkg_food_contact_declaration_file}
                  onChange={(f) => setField("pkg_food_contact_declaration_file", f)}
                  disabled={!canEdit}
                  fieldKey="pkg_food_contact_declaration_file"
                  focusField={focusField}
                  blurField={blurField}
                  editor={fieldEditors["pkg_food_contact_declaration_file"]}
                />
                <FieldError messages={fieldErrors["packaging_compliance.food_contact_declaration_file_id"]} />
              </FieldRow>
              <Grid>
                <FieldRow label="Migration test report">
                  <ItemFileUploadField
                    itemUuid={item?.uuid ?? null}
                    kind="migration_test"
                    file={state.pkg_migration_test_file}
                    onChange={(f) => setField("pkg_migration_test_file", f)}
                    disabled={!canEdit}
                    fieldKey="pkg_migration_test_file"
                    focusField={focusField}
                    blurField={blurField}
                    editor={fieldEditors["pkg_migration_test_file"]}
                  />
                  <FieldError messages={fieldErrors["packaging_compliance.migration_test_file_id"]} />
                </FieldRow>
                <FieldRow label="Migration test expires" hint="Feeds the expiring-soon queue.">
                  <Input type="date" value={state.pkg_migration_test_expires_at} onChange={(e) => setField("pkg_migration_test_expires_at", e.target.value)} onFocus={() => focusField("pkg_migration_test_expires_at")} onBlur={() => blurField("pkg_migration_test_expires_at")} />
                  <FieldEditingIndicator peer={fieldEditors["pkg_migration_test_expires_at"]} />
                  <FieldError messages={fieldErrors["packaging_compliance.migration_test_expires_at"]} />
                </FieldRow>
              </Grid>
            </>
          )}

          {!isEdit && (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground">
              Compliance, risk, spec, and packaging sub-forms appear after you create the item.
            </div>
          )}
        </fieldset>

        {actionError && (
          <ErrorBanner detail={actionError.detail} code={actionError.code} debug={actionError.debug} />
        )}

        {canEdit && !isCreator && creator && (
          <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Only <span className="font-medium text-foreground">{creator.name}</span> can {isEdit ? "save" : "create"} from this room. Your edits sync live.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {isEdit && canEdit && isCreator ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={pending} className="text-destructive hover:text-destructive">
              <Trash2 className="mr-1.5 size-3.5" />
              Delete item
            </Button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {dirty && !pending && isCreator && (
              <Button type="button" variant="ghost" onClick={onReset}>Discard</Button>
            )}
            <Button type="button" variant="ghost" onClick={() => router.push("/settings/items")}>Cancel</Button>
            {canEdit && (
              <Button type="submit" disabled={!dirty || pending || !isCreator || !(typeof state.name === "string" && state.name.trim())} title={isCreator ? undefined : creator ? `Only ${creator.name} can ${isEdit ? "save" : "create"} from this room.` : undefined}>
                {pending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Save className="mr-1.5 size-4" />}
                {isEdit ? "Save changes" : "Create item"}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="space-y-0.5 border-t border-border/40 pt-6">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

function FieldRow({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      <div className="relative">{children}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function EnumLiveRow({
  label,
  fieldKey,
  value,
  options,
  setField,
  focusField,
  blurField,
  editor,
  errors,
  hint,
}: {
  label: string;
  fieldKey: keyof FormState;
  value: string;
  options: Array<{ value: string; label: string }>;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  editor: CollabPeer | null | undefined;
  errors?: string[];
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="relative">
        <Select value={value === "" ? ANY_SENTINEL : value} onValueChange={(v) => setField(fieldKey, (v === ANY_SENTINEL ? "" : v) as never)}>
          <SelectTrigger onFocus={() => focusField(fieldKey as string)} onBlur={() => blurField(fieldKey as string)}>
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_SENTINEL}>— Not set —</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldEditingIndicator peer={editor ?? null} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError messages={errors} />
    </div>
  );
}

function TextLiveRow({
  label,
  fieldKey,
  value,
  setField,
  focusField,
  blurField,
  editor,
  errors,
  hint,
  placeholder,
  type = "text",
  step,
  maxLength,
  mono,
  transform,
}: {
  label: string;
  fieldKey: keyof FormState;
  value: string;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  editor: CollabPeer | null | undefined;
  errors?: string[];
  hint?: string;
  placeholder?: string;
  type?: string;
  step?: string;
  maxLength?: number;
  mono?: boolean;
  transform?: (v: string) => string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="relative">
        <Input type={type} step={step} maxLength={maxLength} inputMode={type === "number" ? "decimal" : undefined} value={value} onChange={(e) => setField(fieldKey, (transform ? transform(e.target.value) : e.target.value) as never)} onFocus={() => focusField(fieldKey as string)} onBlur={() => blurField(fieldKey as string)} placeholder={placeholder} className={mono ? "font-mono" : undefined} />
        <FieldEditingIndicator peer={editor ?? null} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError messages={errors} />
    </div>
  );
}

function UnitPickerLive({
  label,
  fieldKey,
  value,
  units,
  setField,
  focusField,
  blurField,
  editor,
  errors,
}: {
  label: string;
  fieldKey: keyof FormState;
  value: string;
  units: UnitOfMeasurement[];
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  focusField: (field: string) => void;
  blurField: (field: string) => void;
  editor: CollabPeer | null | undefined;
  errors?: string[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      <div className="relative">
        <Select value={value === "" ? ANY_SENTINEL : value} onValueChange={(v) => setField(fieldKey, (v === ANY_SENTINEL ? "" : v) as never)}>
          <SelectTrigger onFocus={() => focusField(fieldKey as string)} onBlur={() => blurField(fieldKey as string)}>
            <SelectValue placeholder="Pick a unit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_SENTINEL}>— Not set —</SelectItem>
            {units.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.symbol})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldEditingIndicator peer={editor ?? null} />
      </div>
      <FieldError messages={errors} />
    </div>
  );
}

function DynamicAttributeRow({
  def_,
  value,
  onChange,
  onFocus,
  onBlur,
  editor,
}: {
  def_: AttributeDefinition;
  value: unknown;
  onChange: (v: unknown) => void;
  onFocus: () => void;
  onBlur: () => void;
  editor: CollabPeer | null | undefined;
}) {
  const hint = def_.help_text ?? undefined;
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {def_.label}
        {def_.required && <span className="ml-0.5 text-destructive">*</span>}
        {def_.unit_symbol && <span className="ml-1 text-xs text-muted-foreground">({def_.unit_symbol})</span>}
      </Label>
      <div className="relative">
        {def_.attribute_type === "text" && (<Input type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur} />)}
        {def_.attribute_type === "url" && (<Input type="url" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} onFocus={onFocus} onBlur={onBlur} placeholder="https://…" />)}
        {def_.attribute_type === "number" && (<Input type="number" value={typeof value === "number" || typeof value === "string" ? String(value) : ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} onFocus={onFocus} onBlur={onBlur} inputMode="decimal" className="font-mono" />)}
        {def_.attribute_type === "date" && (<Input type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} onFocus={onFocus} onBlur={onBlur} />)}
        {def_.attribute_type === "boolean" && (
          <label className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm">
            <Checkbox checked={Boolean(value)} onCheckedChange={(c) => onChange(Boolean(c))} />
            <span className="text-xs text-muted-foreground">Yes / No</span>
          </label>
        )}
        {def_.attribute_type === "enum" && (
          <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v)}>
            <SelectTrigger onFocus={onFocus} onBlur={onBlur}><SelectValue placeholder="Pick…" /></SelectTrigger>
            <SelectContent>
              {def_.enum_choices.map((c) => (<SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
        <FieldEditingIndicator peer={editor ?? null} />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function JoinErrorCard({ error, isEdit }: { error: JoinError; isEdit: boolean }) {
  const config = {
    form_full: { icon: AlertCircle, title: "Form is at capacity", detail: error.limit ? `Up to ${error.limit} people can edit this form at once. Wait for someone to leave, then refresh.` : "Wait for someone to leave, then refresh." },
    forbidden: { icon: LockKeyhole, title: "You can't edit here", detail: "Ask an admin for the `items.edit` permission to join this form." },
    bad_topic: { icon: AlertCircle, title: "Unknown form", detail: "Couldn't recognise this form's address — try reloading." },
    unknown: { icon: AlertCircle, title: "Couldn't join", detail: "The realtime connection refused this form. Try reloading." },
  }[error.reason] ?? { icon: AlertCircle, title: "Couldn't join", detail: "The realtime connection refused this form. Try reloading." };
  const Icon = config.icon;
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-background p-5">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-semibold">{config.title}</p>
          <p className="text-xs text-muted-foreground">{config.detail}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {isEdit ? "This item's edit form is shared in real time." : "The new-item draft form is shared in real time."}
      </p>
    </div>
  );
}

/**
 * Compliance evidence upload widget. Mirrors the vendor file pattern
 * — pick → POST multipart → render filename + serve link + remove
 * affordance. Disabled when the parent item doesn't exist yet
 * (uploads need a UUID to scope under), in which case we explain
 * why and ask the user to save first.
 */
function ItemFileUploadField({
  itemUuid,
  kind,
  file,
  onChange,
  disabled,
  fieldKey,
  focusField,
  blurField,
  editor,
}: {
  itemUuid: string | null;
  kind: ItemFileKind;
  file: ItemFile | null;
  onChange: (f: ItemFile | null) => void;
  disabled?: boolean;
  fieldKey: string;
  focusField: (key: string) => void;
  blurField: (key: string) => void;
  editor: CollabPeer | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, startUpload] = useTransition();
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handlePick(picked: File | undefined) {
    if (!picked || !itemUuid) return;
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", picked);

    setUploadError(null);
    startUpload(async () => {
      const res = await uploadItemFileAction(itemUuid, fd);
      if (res.ok) {
        onChange(res.file);
        toast.success(`Uploaded ${res.file.filename}`);
      } else {
        setUploadError(res.detail);
      }
    });
  }

  if (!itemUuid) {
    return (
      <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        Save the item first, then come back to attach the file.
      </p>
    );
  }

  if (file) {
    return (
      <div className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
        <Paperclip className="size-3 shrink-0 text-muted-foreground" />
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          title={`${file.filename} · ${formatItemFileBytes(file.byte_size)}`}
          className="min-w-0 flex-1 truncate text-[11px] hover:underline"
        >
          {file.filename}
        </a>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove file"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <Trash2 className="size-3" />
          </button>
        )}
        <FieldEditingIndicator peer={editor} />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx,.xls,.xlsx,.txt"
        className="hidden"
        onChange={(e) => handlePick(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          focusField(fieldKey);
          inputRef.current?.click();
        }}
        onBlur={() => blurField(fieldKey)}
        disabled={uploading || disabled}
        className="h-8 w-full text-xs"
      >
        {uploading ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
        ) : (
          <Upload className="mr-1.5 size-3.5" />
        )}
        {uploading ? "Uploading…" : "Upload file"}
      </Button>
      {uploadError && (
        <p className="text-[10px] text-destructive">{uploadError}</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        PDF, image, Word, Excel, or text · max 20 MB
      </p>
      <FieldEditingIndicator peer={editor} />
    </div>
  );
}

function formatItemFileBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Compliance gate banner — sits above the form fieldsets and is the
 * primary surface for the `draft` ↔ `ready_for_use` transition.
 *
 * Behaviour:
 *   * `ready_for_use` → green banner + readied-by stamp + "Revert"
 *     button (opens the justification dialog)
 *   * `draft` with no blockers → amber "Ready to promote" + CTA
 *   * `draft` with blockers → red banner listing every missing field
 *     with a click-to-scroll affordance so workers fix them in order
 *
 * Blocker source: `freshBlockers` if the user just tried mark-ready
 * and we have a server-emitted list; otherwise `item.compliance_blockers`
 * computed by the payload renderer.
 */
function ComplianceGateBanner({
  item,
  canEdit,
  freshBlockers,
  pending,
  revertOpen,
  revertReason,
  onMarkReady,
  onOpenRevert,
  onCloseRevert,
  onChangeRevertReason,
  onConfirmRevert,
}: {
  item: Item;
  canEdit: boolean;
  freshBlockers: import("@/lib/types").ItemComplianceBlocker[] | null;
  pending: boolean;
  revertOpen: boolean;
  revertReason: string;
  onMarkReady: () => void;
  onOpenRevert: () => void;
  onCloseRevert: () => void;
  onChangeRevertReason: (s: string) => void;
  onConfirmRevert: () => void;
}) {
  const blockers = freshBlockers ?? item.compliance_blockers ?? [];
  const isReady = item.compliance_status === "ready_for_use";

  return (
    <>
      <section
        className={
          isReady
            ? "rounded-md border border-emerald-300/60 bg-emerald-50 p-4 dark:bg-emerald-950/30"
            : blockers.length === 0
              ? "rounded-md border border-amber-300/60 bg-amber-50 p-4 dark:bg-amber-950/30"
              : "rounded-md border border-destructive/40 bg-destructive/5 p-4"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {isReady ? (
                <>
                  <span className="inline-flex size-2 rounded-full bg-emerald-500" />
                  Ready for use
                </>
              ) : blockers.length === 0 ? (
                <>
                  <span className="inline-flex size-2 rounded-full bg-amber-500" />
                  Draft — all checks pass, ready to promote
                </>
              ) : (
                <>
                  <AlertCircle className="size-4 text-destructive" />
                  Draft — {blockers.length} field{blockers.length === 1 ? "" : "s"} blocking ready-for-use
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {isReady && item.compliance_readied_by ? (
                <>
                  Signed off by {item.compliance_readied_by.name}
                  {item.compliance_readied_at
                    ? ` on ${new Date(item.compliance_readied_at).toLocaleString()}`
                    : ""}
                  . Items in draft are refused by PO lines + BOMs.
                </>
              ) : isReady ? (
                <>This item passes the regulatory check and can be put on PO lines.</>
              ) : (
                <>
                  Items in draft can't be added to PO lines or BOMs. Fill in the
                  missing fields below to promote.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && !isReady && (
              <Button
                size="sm"
                onClick={onMarkReady}
                disabled={pending || blockers.length > 0}
              >
                {pending ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : null}
                Mark ready for use
              </Button>
            )}
            {canEdit && isReady && (
              <Button
                size="sm"
                variant="outline"
                onClick={onOpenRevert}
                disabled={pending}
              >
                Revert to draft…
              </Button>
            )}
          </div>
        </div>

        {!isReady && blockers.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[12px]">
            {blockers.map((b) => (
              <li
                key={b.field}
                className="flex items-start gap-2 rounded-sm border border-destructive/20 bg-background/60 px-2 py-1.5"
              >
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.querySelector(
                        `[data-field-key="${b.field}"]`,
                      );
                      if (el && "scrollIntoView" in el) {
                        (el as HTMLElement).scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }
                    }}
                    className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {b.field}
                  </button>
                  <p className="text-foreground">{b.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {item.compliance_revert_reason && !isReady && (
          <p className="mt-3 rounded-sm border border-border/60 bg-background px-2 py-1.5 text-[11px] italic text-muted-foreground">
            Reverted: {item.compliance_revert_reason}
          </p>
        )}
      </section>

      {revertOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Revert to draft</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Auditors ask why a ready item went back to draft. Give the
              reason — it lands on the audit log + on this item until the
              next mark-ready.
            </p>
            <Textarea
              autoFocus
              value={revertReason}
              onChange={(e) => onChangeRevertReason(e.target.value)}
              rows={3}
              placeholder="e.g. supplier swapped to non-organic source — need new SAQ + cert"
              className="mt-3"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={onCloseRevert}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onConfirmRevert}
                disabled={!revertReason.trim() || pending}
              >
                Revert
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
