defmodule Backend.Repo.Migrations.AllowMultipleSampleCosPerFormulation do
  use Ecto.Migration

  # The original unique index on ``(company_id, npd_formulation_uuid)``
  # was written for the commercial ``upsert_from_npd`` path — one CO
  # per formulation, keyed on formulation uuid. That model doesn't fit
  # the sample flow: a single RTG formulation is ordered by many
  # customers, so N sample COs legitimately share ``npd_formulation_uuid``.
  #
  # Sample COs already have their own identity guard: ``uuid =
  # npd_sample_payment_uuid`` (unique per customer + order). So the
  # only fix needed here is to scope the uniqueness constraint to
  # non-sample rows.
  #
  # ``concurrently: true`` (+ ``@disable_ddl_transaction``) so the
  # swap doesn't block writes on a live shipments table with millions
  # of historical rows.
  @disable_ddl_transaction true
  @disable_migration_lock true

  def up do
    drop_if_exists index(:customer_orders, [:company_id, :npd_formulation_uuid],
                     name: :customer_orders_npd_formulation_uuid_index,
                     concurrently: true
                   )

    create_if_not_exists index(
                          :customer_orders,
                          [:company_id, :npd_formulation_uuid],
                          unique: true,
                          where:
                            "npd_formulation_uuid IS NOT NULL AND sample_kind = false",
                          name: :customer_orders_npd_formulation_uuid_index,
                          concurrently: true
                        )
  end

  def down do
    drop_if_exists index(:customer_orders, [:company_id, :npd_formulation_uuid],
                     name: :customer_orders_npd_formulation_uuid_index,
                     concurrently: true
                   )

    create_if_not_exists index(
                          :customer_orders,
                          [:company_id, :npd_formulation_uuid],
                          unique: true,
                          where: "npd_formulation_uuid IS NOT NULL",
                          name: :customer_orders_npd_formulation_uuid_index,
                          concurrently: true
                        )
  end
end
