defmodule Backend.Repo.Migrations.AddRouteChoiceToBookings do
  use Ecto.Migration

  # ``route_choice`` records the operator's explicit intent at closeout
  # time — did they choose to keep the leftover ingredient at the
  # production_feed cell (``keep_in_place``) or send it back to a
  # warehouse dispatch cell (``send_to_warehouse``)? ``auto`` is the
  # neutral default: no leftover to route (fully consumed).
  #
  # Without this field, the "kept ingredients at production" dashboard
  # can't distinguish an intentional keep from a placement that happens
  # to sit at production_feed for unrelated reasons (child MO output,
  # partial mid-pickup abort, etc.). The route_choice + Placement.kept_at
  # pair are the queryable audit trail of "operator decided X at Y".
  #
  # Nullable: existing bookings pre-hardening don't carry a choice.
  # New bookings stamp this at close_booking time.
  def change do
    alter table(:manufacturing_order_bookings) do
      add :route_choice, :string, null: true
    end
  end
end
