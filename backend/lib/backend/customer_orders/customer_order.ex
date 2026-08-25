defmodule Backend.CustomerOrders.CustomerOrder do
  @moduledoc """
  One customer order — sell-side mirror of `Backend.Purchasing.PurchaseOrder`.

  State machine + identity columns only — line items live in
  `customer_order_lines`; ESIGN signatures live in
  `customer_order_approvals`.

  Display code (`CO00001`) is rendered from `id` + the company's
  numbering format — no stored `code` column.

  Money columns split the same way as PO:

    * **Castable from the form** — `discount_pct`, `tax_rate`,
      `shipping_fees`, `additional_fees`. These are what the
      salesperson types.

    * **Server-computed only** — `subtotal`, `discount_amount`,
      `tax_amount`, `grand_total`. Derived in
      `Backend.CustomerOrders.recompute_totals/1` after any line /
      rate change. Live on `totals_changeset/2` so the user-facing
      changeset can never smuggle a hand-typed total in.
  """

  use Ecto.Schema
  import Ecto.Changeset

  alias Backend.Accounts.User
  alias Backend.Companies.Company
  alias Backend.Customers.Customer
  alias Backend.CustomerOrders.{
    CustomerOrderApproval,
    CustomerOrderFile,
    CustomerOrderLine
  }
  alias Backend.Warehouses.Warehouse

  @statuses ~w(draft pending_approver pending_director approved confirmed cancelled)

  schema "customer_orders" do
    field :uuid, Ecto.UUID, autogenerate: true

    field :status, :string, default: "draft"

    field :currency_code, :string, default: "GBP"

    field :subtotal, :decimal, default: Decimal.new(0)
    field :discount_pct, :decimal, default: Decimal.new(0)
    field :discount_amount, :decimal, default: Decimal.new(0)
    field :tax_rate, :decimal, default: Decimal.new(0)
    field :tax_amount, :decimal, default: Decimal.new(0)
    field :shipping_fees, :decimal, default: Decimal.new(0)
    field :additional_fees, :decimal, default: Decimal.new(0)
    field :grand_total, :decimal, default: Decimal.new(0)

    field :expected_ship_date, :date
    # Customer-facing deadline. Distinct from `expected_ship_date`
    # (internal shipping ETA). Drives the /my-tasks urgency bucketing
    # + the wizard's "due in N days" pill.
    field :due_date, :date
    field :delivery_address, :string
    field :customer_reference, :string
    field :notes, :string

    # ``true`` when this CO was created from an NPD sample-fulfilment
    # push (customer ordered a sample via the portal, R&D scientist
    # spun a trial batch, clicked Create MO on PSP). The /projects
    # kanban renders a "Sample" chip on these rows to distinguish
    # them from real commercial orders. Populated exclusively by
    # ``Backend.CustomerOrders.NpdSync.upsert_sample_from_npd/2``.
    field :sample_kind, :boolean, default: false

    # NPD payment mirror — populated by the sample-sync so the PSP
    # invoice panel can render the customer payment record (amount,
    # invoice number, paid date, attached files) instead of the
    # default "No invoice attached. Generate invoice?" prompt. For
    # sample COs the payment IS the invoice — no PSP-side invoice
    # is generated because finance already processed it on NPD.
    # ``npd_payment_files`` is a list of ``%{uuid, filename, mime,
    # byte_size, uploaded_at}`` maps — bytes stay on NPD; the CO
    # detail card renders filenames + metadata only.
    field :npd_payment_id, Ecto.UUID
    field :npd_payment_amount, :decimal
    field :npd_payment_currency, :string
    field :npd_payment_invoice_number, :string
    field :npd_payment_paid_at, :utc_datetime
    field :npd_payment_status, :string
    field :npd_payment_files, {:array, :map}, default: []

    field :submitted_at, :utc_datetime
    field :confirmed_at, :utc_datetime
    field :cancelled_at, :utc_datetime
    field :cancellation_reason, :string

    # NPD (vita-cff) formulation identity. Planted on first sync from
    # NPD's ``save_version`` cascade so the same UUID identifies the
    # project on both sides. Null on any CO that was created directly
    # from PSP's own new-project flow (pre-NPD or non-R&D orders).
    field :npd_formulation_uuid, Ecto.UUID
    # Denormalised R&D team + deep-link mirrored from NPD's sync
    # payload. Refreshed on every re-sync so a role reassignment on
    # NPD reaches PSP without a separate messaging channel. All three
    # are nullable — R&D projects often start with no assignments.
    field :npd_lead_scientist_name, :string
    field :npd_sales_person_name, :string
    field :npd_app_url, :string
    # Linked customer mirrored from NPD's ``link_customer`` flow.
    # Both fields empty until Sales attaches a client on NPD; they
    # clear back to nil on unlink. Display-only today — PSP still
    # writes ``customer_id`` from its own picker for the real FK.
    field :npd_customer_uuid, Ecto.UUID
    field :npd_customer_display_name, :string
    # CFF submission mirrored from NPD's ``assign_to_project`` /
    # ``detach_from_project`` hooks. Cleared on unlink so the PSP
    # project page mirrors whatever the scientist sees on NPD.
    field :npd_cff_uuid, Ecto.UUID
    field :npd_cff_url, :string
    field :npd_cff_submitter_name, :string
    field :npd_cff_submitter_email, :string
    # Spec-sheet identity + sign-off, populated on the NPD sheet's
    # ``in_review → approved`` transition. The presence of
    # ``npd_spec_approved_at`` is the phase-gate signal: a draft CO
    # with a director-signed spec moves from ``:r_and_d`` to
    # ``:awaiting_proposal`` on the wizard. A subsequent proposal
    # merge sync moves the wizard through the three proposal blocks
    # (Awaiting approval → Ready to send → Awaiting customer signature).
    field :npd_spec_sheet_uuid, Ecto.UUID
    field :npd_spec_sheet_url, :string
    field :npd_spec_prepared_by_name, :string
    field :npd_spec_prepared_at, :utc_datetime
    field :npd_spec_director_name, :string
    field :npd_spec_approved_at, :utc_datetime
    # Proposal identity, planted on the primary CO by the merge sync
    # (``Backend.CustomerOrders.ProposalMerge``). Presence of
    # ``npd_proposal_uuid`` is the phase-gate signal: draft CO with a
    # proposal moves from ``:awaiting_proposal`` to ``:awaiting_signature``
    # on the wizard.
    field :npd_proposal_uuid, Ecto.UUID
    field :npd_proposal_code, :string
    field :npd_proposal_url, :string
    # Per-transition timestamps + actor names mirrored from NPD's
    # ``ProposalStatusTransition`` table. Populate the timeline card
    # so operators see when the proposal was drafted, director-signed,
    # sent to the customer, and customer-signed — without a cross-app
    # fetch. NULL until the transition happens on NPD.
    field :npd_proposal_created_at, :utc_datetime
    field :npd_proposal_created_by_name, :string
    field :npd_proposal_director_approved_at, :utc_datetime
    field :npd_proposal_director_name, :string
    field :npd_proposal_sent_at, :utc_datetime
    field :npd_proposal_sent_by_name, :string
    field :npd_proposal_accepted_at, :utc_datetime
    field :npd_proposal_accepted_by_name, :string
    # Customer-side sign timestamp. Distinct from
    # ``npd_proposal_accepted_at`` — signing captures the
    # signature but the FSM stays at ``sent``; finance runs a
    # separate finalize step to flip status to ``accepted``.
    # Presence here (with npd_proposal_status = "sent") is what
    # unlocks the ``:awaiting_sample_selection`` kanban column.
    field :npd_customer_signed_at, :utc_datetime
    # Mirrored ``SampleAllocation.status`` — ``"draft"`` while the
    # customer is still poking at the picker, ``"confirmed"`` once
    # they've committed. Nil when the allocation row doesn't
    # exist yet OR (legacy) when the vita-cff sync predates the
    # sample-selection feature. Drives the kanban split between
    # ``:awaiting_sample_selection`` and ``:proposal_accepted``.
    field :npd_sample_allocation_status, :string
    # Bundled deposit+samples Payment approval timestamp mirrored
    # from vita-cff. Presence flips the wizard phase from
    # ``:proposal_accepted`` ("Awaiting R&D payment") to
    # ``:trial_batches_in_flight`` ("Trial batches") so operators
    # can see the cycle has started without opening the CO detail.
    field :npd_deposit_paid_at, :utc_datetime

    # ---- Trial-batch cycle mirror --------------------------------
    # Populated by NpdSync.upsert_sample_from_npd when a sample CO
    # is created for a slot in a vita-cff TrialBatchCycle. Drives
    # the "↳ Trial N/M · <ref>" badge on the /projects kanban so
    # scientists can eyeball which sample MO cards belong to the
    # same custom-formulation project. All four stay nil on
    # storefront sample-kit orders (no cycle involved).
    field :parent_customer_order_uuid, Ecto.UUID
    field :parent_customer_order_reference, :string
    field :npd_trial_slot_sequence_no, :integer
    field :npd_trial_slot_total, :integer
    # FINAL-spec + FINAL-payment lifecycle mirror. Gate signals for
    # the `:awaiting_final_spec` and `:needs_mo_creation` phases
    # (see `Backend.OrderWizard.derive_phase/3`). Rejection is
    # self-healing: vita-cff clears `customer_confirmed_done_at` on
    # the reopen-cycle hook and re-fires the sync, which nulls the
    # mirror here — the CO falls back to `:trial_batches_in_flight`
    # automatically on the next `derive_phase` call.
    field :npd_customer_confirmed_done_at, :utc_datetime
    field :npd_final_spec_uuid, Ecto.UUID
    field :npd_final_spec_status, :string
    field :npd_final_spec_signed_at, :utc_datetime
    field :npd_final_spec_rejected_at, :utc_datetime
    # Finance approving the FINAL invoice is what promotes the CO
    # from `:awaiting_final_spec` to `:needs_mo_creation` — the
    # customer has paid, production is authorised.
    field :npd_final_payment_approved_at, :utc_datetime
    # ---- Label-design workflow mirror ---------------------------
    # Populated by vita-cff's label_design app via a `post_save`
    # signal that fires `_sync_formulation_proposal_to_psp` on any
    # LabelDesign mutation. All fields nil when no LabelDesign row
    # exists yet for the formulation (customer hasn't reached the
    # label phase, or the sync predates this feature).
    field :npd_label_design_uuid, Ecto.UUID
    field :npd_label_status, :string
    field :npd_label_design_path, :string
    field :npd_label_approved_at, :utc_datetime
    field :npd_label_rejection_count, :integer
    field :npd_label_updated_at, :utc_datetime
    field :npd_label_preview_png_url, :string
    field :npd_label_pdf_url, :string
    field :npd_label_url, :string
    # Supplementary artwork views on the CURRENT LabelDesign revision
    # (back / side / bottle mockup). List of ``%{uuid, label,
    # content_type, filename, byte_size, file_url}`` maps — the file
    # bytes stay on NPD, PSP proxies opens through its own origin.
    # Empty when no revision or no extras.
    field :npd_label_files, {:array, :map}, default: []
    # One URL vita-cff picked for PSP to render as the project's
    # header image (dashboard tile + detail hero). Priority chain
    # runs on NPD: approved label preview PNG → first product photo
    # → empty. Empty renders a neutral placeholder on PSP.
    field :npd_header_image_url, :string
    # Full audit-preserving event log — one entry per NPD-side event
    # (formulation created, spec transitioned, proposal transitioned).
    # NPD is authoritative and replaces the array on every sync so a
    # correction or revert-and-redo is reflected without merging
    # deltas. Entries are opaque maps; see the migration for shape.
    field :npd_timeline, {:array, :map}, default: []
    # Mirrored NPD proposal status. Determines which of the four
    # post-merge wizard blocks the CO sits in:
    # draft     → :awaiting_proposal_approval  ("Drafting proposal")
    # in_review → :proposal_in_review          ("Proposal in review")
    # approved  → :proposal_ready_to_send
    # sent      → :awaiting_customer_signature.
    # Every NPD ``transition_status`` call re-syncs, so reverting
    # in_review → draft moves the CO back to the drafting block.
    field :npd_proposal_status, :string

    belongs_to :merged_into, __MODULE__, foreign_key: :merged_into_id
    belongs_to :customer, Customer
    belongs_to :company, Company
    belongs_to :created_by, User
    belongs_to :updated_by, User
    belongs_to :submitted_by, User
    belongs_to :confirmed_by, User
    belongs_to :cancelled_by, User
    belongs_to :default_warehouse, Warehouse

    has_many :lines, CustomerOrderLine, foreign_key: :customer_order_id
    has_many :approvals, CustomerOrderApproval, foreign_key: :customer_order_id
    has_many :files, CustomerOrderFile, foreign_key: :customer_order_id
    # NPD payment mirror — one row per Payment attached to the CO's
    # formulation (deposit / additional_samples / label_design /
    # final). Populated by the main formulation sync; RTG sample
    # payments continue to write the singular ``npd_payment_*`` fields
    # on this row for back-compat.
    has_many :npd_payments,
             Backend.CustomerOrders.NpdPayment,
             foreign_key: :customer_order_id
    # Every CO that was folded into this one during a proposal merge.
    # Preloaded on the detail fetch so the payload can enumerate the
    # spec sheets of the sibling formulations that came in via the
    # same bundled proposal — the primary CO only holds ONE
    # ``npd_spec_sheet_uuid`` on its own row, but a bundled proposal
    # spans N formulations each with its own spec.
    has_many :merged_secondaries, __MODULE__, foreign_key: :merged_into_id

    timestamps(type: :utc_datetime)
  end

  def statuses, do: @statuses

  @doc """
  Header changeset. Only the editable identity fields + rate-style
  money inputs. Status moves through `transition_status_changeset/2`,
  computed totals through `totals_changeset/2`.
  """
  def changeset(co, attrs) do
    co
    |> cast(attrs, [
      :company_id,
      :customer_id,
      :currency_code,
      :discount_pct,
      :tax_rate,
      :shipping_fees,
      :additional_fees,
      :default_warehouse_id,
      :expected_ship_date,
      :due_date,
      :delivery_address,
      :customer_reference,
      :notes,
      :created_by_id,
      :updated_by_id
    ])
    |> validate_required([:company_id, :customer_id, :currency_code])
    |> validate_length(:currency_code, is: 3)
    |> validate_length(:delivery_address, max: 1000)
    |> validate_length(:customer_reference, max: 120)
    |> validate_length(:notes, max: 4000)
    |> validate_number(:discount_pct, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:tax_rate, greater_than_or_equal_to: 0, less_than_or_equal_to: 100)
    |> validate_number(:shipping_fees, greater_than_or_equal_to: 0)
    |> validate_number(:additional_fees, greater_than_or_equal_to: 0)
    # Commercial COs are 1-per-formulation-per-company (the partial
    # unique index scopes it to ``sample_kind = false`` — samples can
    # share the same formulation across many customer orders). Adding
    # the constraint here so a race turns into a changeset error the
    # caller can handle, not a raised ``Ecto.ConstraintError``.
    |> unique_constraint([:company_id, :npd_formulation_uuid],
      name: :customer_orders_npd_formulation_uuid_index,
      message: "already has a customer order for this formulation"
    )
  end

  @doc """
  State-machine transition. Allowed transitions are enforced at the
  context level (`Backend.CustomerOrders.transition/4`); this
  changeset just casts + validates inclusion so a stray attr can't
  smuggle in a bogus state.
  """
  def transition_status_changeset(co, attrs) do
    co
    |> cast(attrs, [
      :status,
      :submitted_at,
      :submitted_by_id,
      :confirmed_at,
      :confirmed_by_id,
      :cancelled_at,
      :cancelled_by_id,
      :cancellation_reason,
      :updated_by_id
    ])
    |> validate_required([:status])
    |> validate_inclusion(:status, @statuses)
  end

  @doc """
  Totals refresh — used by `recompute_totals/1` after any line save
  or rate change. Computed columns live here exclusively.
  """
  def totals_changeset(co, attrs) do
    co
    |> cast(attrs, [
      :subtotal,
      :discount_amount,
      :tax_amount,
      :grand_total,
      :updated_by_id
    ])
    |> validate_required([:subtotal, :grand_total])
  end
end
