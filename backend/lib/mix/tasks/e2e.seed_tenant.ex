defmodule Mix.Tasks.E2e.SeedTenant do
  @moduledoc """
  Seed the PSP side of a cross-system Playwright test run.

  Companion to `vita-cff/server manage.py e2e_seed_tenant`. Fires
  AFTER the Django seed because we want to mirror the finished-product
  UUID Django already assigned (`Formulation.psp_finished_product_uuid`).

  Two constraints shape the implementation:

    * **PSP is single-tenant per deployment** — `Backend.Companies.current/0`
      returns a singleton, no isolation by company_id. Every e2e run
      shares the same company row. Per-run isolation lives in the
      unique email prefixes + warehouse names.
    * **Emails are locked to `@vitamanufacture.co.uk`** on PSP
      (`User.registration_changeset` validates the domain — see
      `lib/backend/accounts/user.ex:19`). Test emails therefore use
      the vita domain with a `-<runid>` suffix so parallel runs don't
      collide.

  Emits JSON on the LAST stdout line — the TypeScript orchestrator
  splits on newlines and takes the last non-empty one.

  ## Usage

      mix e2e.seed_tenant \\
        --run-id abcd1234 \\
        --npd-org-id <uuid> \\
        --finished-item-uuid <uuid> \\
        --json
  """

  use Mix.Task
  require Logger
  import Ecto.Changeset, only: [change: 2]
  import Ecto.Query, only: [from: 2]

  @shortdoc "Seed a PSP tenant for cross-system e2e tests."

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    {opts, _, _} =
      OptionParser.parse(args,
        strict: [
          run_id: :string,
          npd_org_id: :string,
          finished_item_uuid: :string,
          json: :boolean
        ]
      )

    run_id = Keyword.fetch!(opts, :run_id)
    _npd_org_id = Keyword.fetch!(opts, :npd_org_id)
    finished_item_uuid = Keyword.fetch!(opts, :finished_item_uuid)
    emit_json = Keyword.get(opts, :json, false)

    unless String.length(run_id) == 8 do
      Mix.raise("--run-id must be 8 hex chars")
    end

    case Backend.Repo.transaction(fn -> seed(run_id, finished_item_uuid) end,
           timeout: 60_000
         ) do
      {:ok, payload} ->
        if emit_json do
          IO.puts(Jason.encode!(payload))
        else
          IO.puts("Seeded PSP tenant slice #{run_id}")
          IO.puts(Jason.encode!(payload, pretty: true))
        end

      {:error, reason} ->
        Mix.raise("Seed failed: #{inspect(reason)}")
    end
  end

  # --------------------------------------------------------------------
  # Seed body
  # --------------------------------------------------------------------

  defp seed(run_id, finished_item_uuid) do
    alias Backend.{Accounts, Companies, Items, Repo, Vendors}
    alias Backend.Accounts.User
    alias Backend.Warehouses.{Floor, StorageCell, StorageLocation}

    company = Companies.current()

    # ------------------------------------------------------------------
    # 1) Bootstrap the run's actor. First user of the company (if the
    #    DB is fresh) auto-gets is_admin. On subsequent runs the row
    #    exists — we look it up by the deterministic seed-owner email
    #    so the actor stays stable across runs.
    # ------------------------------------------------------------------
    seed_owner_email = "e2e-seed-owner@vitamanufacture.co.uk"

    seed_owner =
      case Repo.get_by(User, email: seed_owner_email) do
        %User{} = u ->
          u

        nil ->
          {:ok, u} =
            Accounts.register_user(
              %{
                email: seed_owner_email,
                name: "E2E Seed Owner",
                password: "SeedOwnerP@ss123!"
              },
              fn _t -> "http://seed/noop" end
            )

          # First user auto-gets is_admin. Mark confirmed_at so downstream
          # UI logins don't need to click a confirmation link.
          u
          |> change(confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second))
          |> Repo.update!()
      end

    # ------------------------------------------------------------------
    # 2) Role users — one per PSP-side role, unique per run.
    # ------------------------------------------------------------------
    create_user = fn prefix, permissions ->
      email = "#{prefix}-#{run_id}@vitamanufacture.co.uk"
      password = "E2E-" <> Base.url_encode64(:crypto.strong_rand_bytes(9))

      {:ok, u} =
        Accounts.register_user(
          %{email: email, name: prefix, password: password},
          fn _t -> "http://seed/noop" end
        )

      # register_user seeds baseline read perms; overlay the role's
      # specific write perms + mark the user confirmed.
      u
      |> change(
        permissions: permissions ++ u.permissions,
        confirmed_at: DateTime.utc_now() |> DateTime.truncate(:second)
      )
      |> Repo.update!()

      %{email: email, password: password}
    end

    planner_a =
      create_user.("psp-planner-a", ~w(production_planning.edit production_planning.approve))

    planner_b =
      create_user.("psp-planner-b", ~w(production_planning.edit production_planning.approve))

    procurement =
      create_user.("procurement", ~w(purchasing.edit purchasing.approve purchasing.validate))

    warehouse_op =
      create_user.("warehouse-op", ~w(warehouse_operations.edit stock.receive stock.putaway))

    qa_a = create_user.("qa-a", ~w(quality_control.edit quality_control.approve))
    qa_b = create_user.("qa-b", ~w(quality_control.edit quality_control.approve))
    worker = create_user.("worker", ~w(production_planning.view))

    # ------------------------------------------------------------------
    # 3) Warehouse + Floor + StorageLocation + StorageCells (one per
    #    purpose the sample-flow needs)
    # ------------------------------------------------------------------
    {:ok, warehouse} =
      Backend.Warehouses.create(seed_owner, company.id, %{
        name: "E2E Warehouse #{run_id}",
        kind: "warehouse"
      })

    floor =
      %Floor{}
      |> change(%{
        warehouse_id: warehouse.id,
        company_id: company.id,
        name: "E2E Floor #{run_id}",
        ordinal: 0,
        canvas_json: %{},
        created_by_id: seed_owner.id,
        updated_by_id: seed_owner.id
      })
      |> Repo.insert!()

    location =
      %StorageLocation{}
      |> change(%{
        warehouse_id: warehouse.id,
        floor_id: floor.id,
        company_id: company.id,
        name: "E2E Shelf #{run_id}",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        tags: [],
        created_by_id: seed_owner.id,
        updated_by_id: seed_owner.id
      })
      |> Repo.insert!()

    purposes = ~w(rnd quarantine finished_quarantine dispatch three_pl_storage)

    # Each cell needs a unique ``ordinal`` within its storage_location
    # (partial unique index enforces one-slot-per-position).
    purposes
    |> Enum.with_index()
    |> Enum.each(fn {purpose, idx} ->
      %StorageCell{}
      |> StorageCell.changeset(%{
        storage_location_id: location.id,
        company_id: company.id,
        name: "#{String.capitalize(purpose)}-#{run_id}",
        ordinal: idx,
        purpose: purpose,
        width_m: Decimal.new("1.0"),
        depth_m: Decimal.new("1.0"),
        height_m: Decimal.new("1.0"),
        max_weight_kg: Decimal.new("100"),
        tags: [],
        created_by_id: seed_owner.id,
        updated_by_id: seed_owner.id
      })
      |> Repo.insert!()
    end)

    # ------------------------------------------------------------------
    # 4) Mirror the finished product from NPD. Django already assigned
    #    the UUID — we pin it here so subsequent MO create calls from
    #    NPD find the item without a round-trip.
    # ------------------------------------------------------------------
    # UnitOfMeasurement has ``name`` + ``symbol`` (no ``code`` column).
    # ``Backend.Units.seed_defaults_for_company/1`` seeds the standard
    # set at company create — grab whichever piece-count row exists.
    pcs_uom =
      Repo.get_by(Backend.Units.UnitOfMeasurement, company_id: company.id, symbol: "pcs") ||
        Repo.get_by(Backend.Units.UnitOfMeasurement, company_id: company.id, name: "Pieces") ||
        Repo.one(
          from u in Backend.Units.UnitOfMeasurement,
            where: u.company_id == ^company.id,
            limit: 1
        )

    {:ok, finished_item} =
      Items.create(seed_owner, company.id, %{
        name: "E2E RTG Sample #{run_id}",
        item_type: "finished_product",
        external_sku: "E2E-FP-#{run_id}",
        stock_uom_id: pcs_uom && pcs_uom.id,
        attributes: %{},
        compliance_status: "ready_for_use"
      })

    # ``Item.uuid`` is Ecto.UUID with ``autogenerate: true`` — the
    # value we pass on create is ignored. Overwrite it here so it
    # matches the UUID Django already stamped on
    # ``Formulation.psp_finished_product_uuid`` — MO create from NPD
    # resolves the item by this uuid, so a mismatch would fail with
    # "item not found on PSP".
    {1, _} =
      Repo.update_all(
        from(i in Backend.Items.Item, where: i.id == ^finished_item.id),
        set: [uuid: finished_item_uuid]
      )

    finished_item = %{finished_item | uuid: finished_item_uuid}

    # ------------------------------------------------------------------
    # 5) Vendor + one raw-material ingredient + approve the vendor for it.
    #    Enough to exercise Phase 3 (shortages → PO → goods-in).
    # ------------------------------------------------------------------
    {:ok, vendor} =
      Vendors.create(seed_owner, company.id, %{
        name: "E2E Vendor #{run_id}",
        legal_name: "E2E Vendor Ltd #{run_id}",
        approval_status: "approved"
      })

    {:ok, ingredient} =
      Items.create(seed_owner, company.id, %{
        name: "E2E Vitamin C Powder #{run_id}",
        item_type: "raw_material",
        external_sku: "E2E-RM-#{run_id}",
        stock_uom_id: pcs_uom && pcs_uom.id,
        attributes: %{},
        compliance_status: "ready_for_use"
      })

    {:ok, _approved} = Vendors.add_approved_item(seed_owner, vendor, ingredient.id)

    %{
      pspCompanyId: company.id,
      pspRdWarehouseUuid: warehouse.uuid,
      pspVendorUuid: vendor.uuid,
      pspFinishedItemUuid: finished_item.uuid,
      accounts: %{
        pspPlannerA: planner_a,
        pspPlannerB: planner_b,
        procurementOfficer: procurement,
        warehouseOperator: warehouse_op,
        qaSignerA: qa_a,
        qaSignerB: qa_b,
        productionWorker: worker
      }
    }
  end
end
