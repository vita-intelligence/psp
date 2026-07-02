defmodule Backend.Stock.Lot do
  @moduledoc """
  One stock lot — the logical batch identity for a physical batch we
  received or produced. `qty_received` is immutable; on-hand and
  available are derived from placements + movements.

  Display code (`SL00012`) is rendered from `id` + the company's
  numbering format — no stored `code` column.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.GoodsIn.Inspection, as: GoodsInInspection
  alias Backend.Items.Item
  alias Backend.Stock.{LotEvent, Movement, Placement}
  alias Backend.Units.UnitOfMeasurement

  # `expected` = PO line approved, no physical receipt yet (system-
  # created planned lot). `requested` = paperwork landed, available_from
  # is future-dated. `received` = goods landed. `quarantine` = held
  # pending QC verdict. `awaiting_release` = MO output past output-QC
  # but not yet QA-signed-off for dispatch; sits in a
  # `finished_quarantine` cell until Final Product Release fires
  # (BRCGS Issue 9 § 5.6 Positive Release). `available` = QC passed
  # (or skipped on flows that auto-clear) — dispatchable. `on_hold`
  # = operator put it on hold post-QC. `rejected` = QC fail.
  # `disposed` = written off. `depleted` = consumed to zero.
  # `canceled` = paperwork voided before receipt.
  @statuses ~w(expected requested received quarantine awaiting_release available
               on_hold depleted disposed rejected canceled)
  @source_kinds ~w(purchase_order manufacturing_order opening_balance return adjustment manual)
  @risk_levels ~w(low medium high)
  @compliance_states ~w(pending requested received accepted rejected na)
  # `own` = we own the goods, freely dispatchable. `bailee` = we hold
  # customer-owned finished goods after a 3PL routing action; billing
  # accrues from `bailee_routed_at` until dispatch. Set by
  # `Backend.ThreePL.route_released_lot/3`, not by an operator picker.
  @ownership_kinds ~w(own bailee)

  def statuses, do: @statuses
  def source_kinds, do: @source_kinds
  def risk_levels, do: @risk_levels
  def compliance_states, do: @compliance_states
  def ownership_kinds, do: @ownership_kinds

  schema "stock_lots" do
    field :uuid, Ecto.UUID, autogenerate: true
    field :status, :string, default: "requested"

    field :qty_received, :decimal
    field :unit_cost, :decimal
    field :currency, :string

    field :source_kind, :string
    field :source_ref, :string

    field :supplier_batch_no, :string
    field :country_of_origin, :string
    field :revision, :string

    field :overall_risk, :string
    field :allergen_status, :string
    field :coa_status, :string
    field :quality_status, :string

    field :manufactured_at, :date
    field :expiry_at, :date
    field :available_from, :utc_datetime
    field :received_at, :utc_datetime

    field :notes, :string

    # Per-lot packaging (mandatory at receive). Lengths in millimetres,
    # weight in kg with 3 decimals. Drives the volumetric + weight fit
    # checks in `list_move_recommendations`. Nullable in DB so the one
    # pre-migration lot doesn't break; the changeset enforces required.
    field :package_length_mm, :integer
    field :package_width_mm, :integer
    field :package_height_mm, :integer
    field :package_weight_kg, :decimal
    # Decimal (numeric(10,3)) so continuous-UoM items can store
    # fractional values — e.g. a 4.4 kg produced bag has
    # units_per_package=4.4. Integer-only values (24 cans, 100
    # capsules) cast losslessly into the same column.
    field :units_per_package, :decimal, default: 1
    field :stack_factor, :integer, default: 1

    # Bailee custody snapshot. `ownership_kind` = `own` until the
    # release wizard routes the lot to 3PL, at which point it flips
    # to `bailee`, `bailee_customer_id` locks the party we're holding
    # for, and `bailee_routed_at` starts the billing clock. See
    # `Backend.ThreePL.route_released_lot/3`.
    field :ownership_kind, :string, default: "own"
    field :bailee_routed_at, :utc_datetime

    belongs_to :company, Company
    belongs_to :item, Item
    belongs_to :unit_of_measurement, UnitOfMeasurement
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :bailee_customer, Customer
    # Back-pointer to the goods-in inspection that governs this lot's
    # QC verdict. Nullable: manual receives and legacy lots stay null
    # and route through the existing quarantine-by-default flow.
    belongs_to :goods_in_inspection, GoodsInInspection

    has_many :placements, Placement, foreign_key: :stock_lot_id
    has_many :movements, Movement, foreign_key: :stock_lot_id
    has_many :events, LotEvent, foreign_key: :stock_lot_id
    # Direct lot attachments (CoA, QC reports, disposal certs, photos).
    # Separate from goods_in_inspection.files — those belong to the
    # inspection record; these can be uploaded any time during the
    # lot's lifecycle.
    has_many :files, Backend.Stock.LotFile, foreign_key: :stock_lot_id
    # Every MO that booked this lot, with the full pick → confirm →
    # consume chain of sign-offs. The reverse view of the chain shown
    # on MO detail.
    has_many :mo_bookings,
             Backend.Production.ManufacturingOrderBooking,
             foreign_key: :stock_lot_id
    # Return picks that moved this lot from production back to the
    # warehouse. Only meaningful for MO-produced lots.
    has_many :return_picks,
             Backend.Warehouses.ReturnPick,
             foreign_key: :stock_lot_id

    timestamps(type: :utc_datetime)
  end

  def changeset(lot, attrs) do
    lot
    |> cast(attrs, [
      :uuid,
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :status,
      :qty_received,
      :unit_cost,
      :currency,
      :source_kind,
      :source_ref,
      :supplier_batch_no,
      :country_of_origin,
      :revision,
      :overall_risk,
      :allergen_status,
      :coa_status,
      :quality_status,
      :manufactured_at,
      :expiry_at,
      :available_from,
      :received_at,
      :notes,
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor,
      :ownership_kind,
      :bailee_customer_id,
      :bailee_routed_at,
      :created_by_id,
      :updated_by_id,
      :goods_in_inspection_id
    ])
    |> validate_required([
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :qty_received,
      :status,
      # source_kind is derived from the calling flow (manual receive
      # ⇒ "manual", PO receive ⇒ "purchase_order") — it's a hard
      # compliance field, NOT NULL at the DB level. Workers never see
      # it on a form.
      :source_kind,
      # Packaging — every new lot must declare its physical footprint
      # so the put-away fit-check can rank cells honestly.
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor
    ])
    |> validate_number(:package_length_mm, greater_than: 0)
    |> validate_number(:package_width_mm, greater_than: 0)
    |> validate_number(:package_height_mm, greater_than: 0)
    |> validate_number(:package_weight_kg, greater_than: 0)
    |> validate_number(:units_per_package, greater_than: 0)
    |> validate_number(:stack_factor, greater_than: 0, less_than_or_equal_to: 50)
    |> validate_inclusion(:status, @statuses)
    |> validate_inclusion(:source_kind, @source_kinds)
    |> validate_inclusion(:ownership_kind, @ownership_kinds)
    |> validate_bailee_consistency()
    |> maybe_validate_inclusion(:overall_risk, @risk_levels)
    |> maybe_validate_inclusion(:allergen_status, @compliance_states)
    |> maybe_validate_inclusion(:coa_status, @compliance_states)
    |> maybe_validate_inclusion(:quality_status, @compliance_states)
    |> validate_number(:qty_received, greater_than: 0)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_length(:currency, is: 3)
    |> validate_length(:supplier_batch_no, max: 120)
    |> validate_length(:country_of_origin, max: 80)
    |> validate_length(:revision, max: 40)
    |> validate_length(:source_ref, max: 80)
  end

  @doc """
  Post-creation edit. `qty_received`, the parent item, and the UoM are
  immutable — qty changes go through `adjust` movements and FK swaps
  would invalidate the lot's identity. Everything else is fair game,
  including packaging (a supplier can change pack size mid-batch and
  we want the updated footprint reflected on the fit-check).

  `source_kind` is intentionally absent from the cast list — it's
  derived from the flow that created the lot and never edited
  afterwards (manual ⇒ "manual", PO receive ⇒ "purchase_order"). The
  same compliance rule applies to `status`: edits route through
  `Backend.Stock.Lifecycle.record_event/4`, which writes the event and
  recomputes the projection. The status field stays casteable on this
  changeset for the system-level projection update; controllers must
  drop it from operator-supplied attrs (see `Backend.Stock.update_lot/4`).
  """
  def edit_changeset(lot, attrs) do
    lot
    |> cast(attrs, [
      :status,
      :unit_cost,
      :currency,
      :source_ref,
      :supplier_batch_no,
      :country_of_origin,
      :revision,
      :overall_risk,
      :allergen_status,
      :coa_status,
      :quality_status,
      :manufactured_at,
      :expiry_at,
      :available_from,
      :received_at,
      :notes,
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor,
      :updated_by_id
    ])
    |> validate_required([
      :status,
      :package_length_mm,
      :package_width_mm,
      :package_height_mm,
      :package_weight_kg,
      :units_per_package,
      :stack_factor
    ])
    |> validate_inclusion(:status, @statuses)
    |> validate_number(:package_length_mm, greater_than: 0)
    |> validate_number(:package_width_mm, greater_than: 0)
    |> validate_number(:package_height_mm, greater_than: 0)
    |> validate_number(:package_weight_kg, greater_than: 0)
    |> validate_number(:units_per_package, greater_than: 0)
    |> validate_number(:stack_factor, greater_than: 0, less_than_or_equal_to: 50)
    |> maybe_validate_inclusion(:overall_risk, @risk_levels)
    |> maybe_validate_inclusion(:allergen_status, @compliance_states)
    |> maybe_validate_inclusion(:coa_status, @compliance_states)
    |> maybe_validate_inclusion(:quality_status, @compliance_states)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_length(:currency, is: 3)
    |> validate_length(:supplier_batch_no, max: 120)
    |> validate_length(:country_of_origin, max: 80)
    |> validate_length(:revision, max: 40)
    |> validate_length(:source_ref, max: 80)
  end

  @doc """
  Service-only status changeset — the Lifecycle module uses this to
  push the recomputed projection onto the lot row after writing an
  event. Caller is trusted (it's a private internal pathway), so we
  only enforce the enum inclusion. Controllers never call this.
  """
  def projected_status_changeset(lot, status) when is_binary(status) do
    lot
    |> cast(%{"status" => status}, [:status])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Planned (`expected`) lot — created when a PO line lands in `ordered`
  status so the UI can show "X arriving" before physical receipt.
  qty_received is 0 (no goods yet), packaging dims are nullable (the
  receiver fills them at receive time), and source_kind is locked to
  `purchase_order`. The lifecycle event log carries the trail; this
  changeset is only ever called by `Backend.Purchasing` so it never
  reads operator-supplied attrs.
  """
  def expected_changeset(lot, attrs) do
    lot
    |> cast(attrs, [
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :qty_received,
      :status,
      :source_kind,
      :source_ref,
      :unit_cost,
      :currency,
      :expiry_at,
      :manufactured_at,
      :available_from,
      :created_by_id,
      :updated_by_id,
      :units_per_package,
      :stack_factor,
      :goods_in_inspection_id
    ])
    |> validate_required([
      :company_id,
      :item_id,
      :unit_of_measurement_id,
      :qty_received,
      :status,
      :source_kind
    ])
    |> validate_inclusion(:status, ["expected"])
    |> validate_number(:qty_received, greater_than_or_equal_to: 0)
    |> validate_number(:unit_cost, greater_than_or_equal_to: 0)
    |> validate_length(:source_ref, max: 80)
    |> validate_length(:currency, is: 3)
  end

  # Inclusion only fires when the field has a value — these are
  # optional enums, so an unset value is valid.
  defp maybe_validate_inclusion(changeset, field, allowed) do
    case get_field(changeset, field) do
      nil -> changeset
      _ -> validate_inclusion(changeset, field, allowed)
    end
  end

  # Mirror of the DB CHECK constraint: ownership_kind = 'bailee'
  # requires both bailee_customer_id and bailee_routed_at; ownership_kind
  # = 'own' requires both to be null. Caught at the changeset boundary
  # so the operator sees a field-level error instead of a raw
  # constraint violation.
  defp validate_bailee_consistency(changeset) do
    case get_field(changeset, :ownership_kind) do
      "bailee" ->
        changeset
        |> validate_required([:bailee_customer_id, :bailee_routed_at])

      "own" ->
        cust = get_field(changeset, :bailee_customer_id)
        routed = get_field(changeset, :bailee_routed_at)

        cond do
          not is_nil(cust) ->
            add_error(
              changeset,
              :bailee_customer_id,
              "must be blank when ownership_kind is 'own'"
            )

          not is_nil(routed) ->
            add_error(
              changeset,
              :bailee_routed_at,
              "must be blank when ownership_kind is 'own'"
            )

          true ->
            changeset
        end

      _ ->
        changeset
    end
  end
end
