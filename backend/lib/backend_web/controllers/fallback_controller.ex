defmodule BackendWeb.FallbackController do
  use BackendWeb, :controller

  alias BackendWeb.Errors

  def call(conn, {:error, :not_found}) do
    conn
    |> put_status(:not_found)
    |> json(Errors.payload("not_found", "We couldn't find what you're looking for."))
  end

  def call(conn, {:error, :unauthorized}) do
    conn
    |> put_status(:unauthorized)
    |> json(
      Errors.payload(
        "unauthorized",
        "You need to sign in to access this."
      )
    )
  end

  def call(conn, {:error, :forbidden}) do
    conn
    |> put_status(:forbidden)
    |> json(
      Errors.payload(
        "forbidden",
        "You don't have permission to do that."
      )
    )
  end

  def call(conn, {:error, :document_not_available}) do
    conn
    |> put_status(:conflict)
    |> json(
      Errors.payload(
        "document_not_available",
        "Documents are available once the director has signed this purchase order."
      )
    )
  end
end
