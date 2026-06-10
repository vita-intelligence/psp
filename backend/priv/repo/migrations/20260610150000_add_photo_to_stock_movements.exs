defmodule Backend.Repo.Migrations.AddPhotoToStockMovements do
  use Ecto.Migration

  @moduledoc """
  Movements optionally carry a photo of where the stock landed (or
  why it was disposed of). When the operator skips the photo at
  scan time, `skip_photo_reason` records why — a small text we can
  later trend to spot warehouses where photo discipline is slipping.

  Storage URL is stored as text rather than a FK to an images table:
  movement photos are append-only and small enough that we keep them
  in the same blob namespace `Backend.Storage` already serves.
  """

  def change do
    alter table(:stock_movements) do
      add :photo_url, :text
      add :skip_photo_reason, :string, size: 120
    end
  end
end
