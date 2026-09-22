defmodule Backend.Repo.Migrations.CreateFormSubmissions do
  @moduledoc """
  Persistent mirror of every DynamicForm response filled on the vp
  kiosk. vp pushes one row per FormResponse via a new outbox kind
  (``form_submission``); PSP is the audit-trail read model for the
  ``/production/sessions`` explorer.

  Why mirror instead of query vp on demand: BRCGS / FSSC 22000 and
  GFSI compliance require the audit trail to remain available when
  the shop-floor stack is down for a maintenance window. Reads on
  PSP also fan out across companies (multi-tenant reporting) and
  benefit from proper indexes owned by the same schema.

  Idempotency:

    * Primary key ``(company_id, vp_response_id)`` — vp will always
      resend the same FormResponse row; the second call updates in
      place instead of duplicating.
    * ``uuid`` gives the PSP FE a stable per-submission URL.

  Snapshotting: ``schema_snapshot`` freezes the DynamicForm.schema at
  submission time so an old response still renders correctly after a
  template is edited or archived. ``form_name`` is copied for the
  same reason — the list page must render even if the template row
  is later renamed.
  """

  use Ecto.Migration

  def change do
    create table(:form_submissions) do
      add :uuid, :uuid, null: false, default: fragment("gen_random_uuid()")
      add :company_id, references(:companies, on_delete: :restrict), null: false

      # Parent workstation session — every submission belongs to one.
      # Nullable so a submission can land before its parent session
      # (out-of-order outbox retries) without violating the FK; the
      # backfill runs in the receive controller once both arrive.
      add :workstation_session_id,
          references(:workstation_sessions, on_delete: :nilify_all)

      add :workstation_session_uuid, :uuid

      # Form template — nullable FK so a submission survives the
      # template being archived / deleted. ``form_template_uuid``
      # is the stable cross-service identifier.
      add :form_template_id,
          references(:form_templates, on_delete: :nilify_all)

      add :form_template_uuid, :uuid, null: false
      add :form_name, :string, size: 200, null: false
      add :form_trigger, :string, size: 40, null: false
      add :schema_snapshot, :map, default: %{}
      add :schema_version, :integer

      # Workstation — always populated. Equipment — populated only
      # for equipment-scoped forms.
      add :workstation_id,
          references(:workstations, on_delete: :nilify_all),
          null: false

      add :workstation_uuid, :uuid, null: false

      add :equipment_id,
          references(:equipment, on_delete: :nilify_all)

      add :equipment_uuid, :uuid

      # Denormalised so the list page can filter by activity_kind
      # without joining the sessions table on every request.
      add :activity_kind, :string, size: 16

      # Who submitted — mirror pattern from workstation_events. The
      # User FK is populated when we can resolve the vp Worker uuid
      # back to a PSP Employee → User; the snapshot fields survive
      # the archive.
      add :submitted_by_id, references(:users, on_delete: :nilify_all)
      add :submitted_by_uuid, :string, size: 128
      add :submitted_by_name, :string, size: 200

      add :submitted_at, :utc_datetime, null: false
      add :answers, :map, default: %{}

      # vp origin id — the FormResponse.pk on the shop-floor stack.
      # Doubles as the idempotency key together with company_id.
      add :vp_response_id, :bigint, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:form_submissions, [:uuid])

    # Idempotency guard for outbox retries — one row per
    # (tenant, vp FormResponse).
    create unique_index(:form_submissions, [:company_id, :vp_response_id],
             name: :form_submissions_company_vp_response_index
           )

    # Filter indexes for the /production/sessions explorer. Each
    # covers one of the four entry-point filters + the natural
    # newest-first order.
    create index(:form_submissions, [:company_id, :submitted_at])

    create index(:form_submissions, [:company_id, :workstation_id, :submitted_at],
             name: :form_submissions_company_ws_time_index
           )

    create index(:form_submissions, [:company_id, :equipment_id, :submitted_at],
             where: "equipment_id IS NOT NULL",
             name: :form_submissions_company_eq_time_index
           )

    create index(:form_submissions, [:company_id, :form_template_id, :submitted_at],
             where: "form_template_id IS NOT NULL",
             name: :form_submissions_company_form_time_index
           )

    create index(:form_submissions, [:company_id, :submitted_by_id, :submitted_at],
             where: "submitted_by_id IS NOT NULL",
             name: :form_submissions_company_user_time_index
           )

    create index(:form_submissions, [:company_id, :workstation_session_id],
             where: "workstation_session_id IS NOT NULL",
             name: :form_submissions_company_session_index
           )

    # Secondary lookup by worker uuid (submissions where we couldn't
    # resolve the User FK — kept queryable via the snapshot uuid).
    create index(:form_submissions, [:company_id, :submitted_by_uuid, :submitted_at],
             where: "submitted_by_uuid IS NOT NULL",
             name: :form_submissions_company_worker_uuid_time_index
           )

    # activity_kind filter (used by the top-level page filter chip).
    create index(:form_submissions, [:company_id, :activity_kind, :submitted_at],
             where: "activity_kind IS NOT NULL",
             name: :form_submissions_company_kind_time_index
           )
  end
end
