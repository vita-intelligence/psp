defmodule Backend.Devices do
  @moduledoc """
  Boundary for linked devices + pairing codes.

  ## Pairing flow

      1. Laptop calls `create_pairing_code/2` → gets a 6-char code +
         expires_at + uuid. The uuid is the channel topic suffix the
         laptop subscribes to (`pairing:<uuid>`) so it can auto-close
         its modal when the phone claims.

      2. Phone POSTs to /api/devices/claim with that code + the
         label/platform/UA it wants to register under. We mark the
         pairing row used, create a `LinkedDevice`, and return the
         **raw** device token (43-char URL-safe base64) exactly once.
         Phone stores it and uses it for every future API call + the
         socket connect (`?device_token=…`).

      3. Phoenix broadcasts `:claimed` on `pairing:<uuid>` so the
         laptop modal closes automatically.

  ## Token storage

  We never store the raw token. The row holds SHA256(token) — a DB
  dump leaks nothing usable. Lookup hashes the presented token and
  matches against `token_hash`.

  ## Revocation

  `revoke/2` sets `revoked_at`. `authenticate_token/1` filters revoked
  rows so the next request from that device 401s.
  """

  import Ecto.Query, warn: false

  alias Backend.Accounts.User
  alias Backend.Devices.{LinkedDevice, PairingCode}
  alias Backend.Repo
  alias BackendWeb.Endpoint

  # 6-char code, drawn from an alphabet that excludes 0/O/1/I/L so
  # operators don't fat-finger the fallback.
  @code_alphabet ~c"ABCDEFGHJKMNPQRSTUVWXYZ23456789"
  @code_length 6
  @code_ttl_seconds 300

  # ----- pairing codes ---------------------------------------------------

  @doc """
  Create a pairing code for `user` (the laptop's session). Returns
  `{:ok, %PairingCode{}}`. Use `pairing.uuid` as the channel topic
  suffix so the laptop modal can listen for the claim.
  """
  def create_pairing_code(%User{} = user, opts \\ []) do
    now = utc_now()
    expires_at = DateTime.add(now, opts[:ttl_seconds] || @code_ttl_seconds, :second)

    do_create_pairing_code(user, expires_at)
  end

  defp do_create_pairing_code(user, expires_at, attempt \\ 0) when attempt < 5 do
    attrs = %{
      user_id: user.id,
      company_id: user.company_id,
      code: random_code(),
      expires_at: expires_at
    }

    case %PairingCode{} |> PairingCode.create_changeset(attrs) |> Repo.insert() do
      {:ok, pairing} ->
        {:ok, pairing}

      {:error, %Ecto.Changeset{errors: [code: {_, [constraint: :unique, constraint_name: _]}]}} ->
        # 30^6 ≈ 730M codes; collision while another live code uses the
        # same string is astronomically unlikely but we retry just in
        # case, ditching the row on uniqueness conflict.
        do_create_pairing_code(user, expires_at, attempt + 1)

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  defp do_create_pairing_code(_user, _expires_at, _attempt),
    do: {:error, :code_generation_exhausted}

  @doc """
  Look up a pairing code for the `/pair` page so the FE can pre-fill
  the label suggestion + verify the code hasn't expired before showing
  the form. Read-only — does NOT consume the code.
  """
  def lookup_pairing_code(code) when is_binary(code) do
    code = String.upcase(String.trim(code))

    case Repo.get_by(PairingCode, code: code) do
      nil -> {:error, :not_found}
      %PairingCode{used_at: nil} = pairing -> validate_unexpired(pairing)
      _ -> {:error, :already_used}
    end
  end

  defp validate_unexpired(%PairingCode{expires_at: expires_at} = pairing) do
    case DateTime.compare(expires_at, utc_now()) do
      :gt -> {:ok, pairing}
      _ -> {:error, :expired}
    end
  end

  @doc """
  Look up a pairing code by its uuid — used by `PairingChannel.join/3`
  to verify the joining user owns the pairing they're subscribing to.
  """
  def lookup_pairing_code_by_uuid(uuid) when is_binary(uuid) do
    case Repo.get_by(PairingCode, uuid: uuid) do
      nil -> {:error, :not_found}
      pairing -> {:ok, pairing}
    end
  end

  # ----- claim -----------------------------------------------------------

  @doc """
  Claim a pairing code from the mobile device. On success returns
  `{:ok, %{device: %LinkedDevice{}, token: raw_token, pairing: pairing}}`
  with the raw token exposed exactly once.

  Required `attrs`: `:code`, `:label`. Optional: `:platform`, `:user_agent`.
  """
  def claim_pairing_code(attrs) when is_map(attrs) do
    code = attrs |> Map.get(:code) |> normalise_code()

    Repo.transaction(fn ->
      with {:ok, pairing} <- claim_lock_pairing(code),
           {:ok, %{device: device, token: token}} <- create_device(pairing, attrs),
           {:ok, pairing} <- mark_pairing_used(pairing, device) do
        broadcast_pairing_claimed(pairing, device)
        %{device: device, token: token, pairing: pairing}
      else
        {:error, reason} -> Repo.rollback(reason)
      end
    end)
  end

  defp claim_lock_pairing(nil), do: {:error, :invalid_code}
  defp claim_lock_pairing(""), do: {:error, :invalid_code}

  defp claim_lock_pairing(code) do
    # SELECT … FOR UPDATE so a double-claim race produces one winner.
    query =
      from p in PairingCode,
        where: p.code == ^code,
        lock: "FOR UPDATE"

    case Repo.one(query) do
      nil -> {:error, :invalid_code}
      %PairingCode{used_at: %DateTime{}} -> {:error, :already_used}
      pairing -> validate_unexpired(pairing)
    end
  end

  defp create_device(%PairingCode{} = pairing, attrs) do
    raw_token = generate_token()
    token_hash = hash_token(raw_token)
    now = utc_now()

    device_attrs = %{
      user_id: pairing.user_id,
      company_id: pairing.company_id,
      label: attrs |> Map.get(:label) |> normalise_label(),
      platform: attrs |> Map.get(:platform) |> normalise_platform(),
      user_agent: attrs |> Map.get(:user_agent) |> normalise_user_agent(),
      token_hash: token_hash,
      paired_at: now,
      last_seen_at: now
    }

    case %LinkedDevice{} |> LinkedDevice.claim_changeset(device_attrs) |> Repo.insert() do
      {:ok, device} ->
        Backend.Broadcasts.entity_changed(
          "linked-device",
          device.uuid,
          device.company_id,
          "registered"
        )

        {:ok, %{device: device, token: raw_token}}

      {:error, changeset} ->
        {:error, changeset}
    end
  end

  defp mark_pairing_used(%PairingCode{} = pairing, %LinkedDevice{id: device_id}) do
    pairing
    |> PairingCode.consume_changeset(%{used_at: utc_now(), used_by_device_id: device_id})
    |> Repo.update()
  end

  defp broadcast_pairing_claimed(%PairingCode{uuid: uuid}, %LinkedDevice{} = device) do
    Endpoint.broadcast!("pairing:#{uuid}", "claimed", %{
      device_uuid: device.uuid,
      label: device.label
    })
  end

  # ----- read ------------------------------------------------------------

  @doc "List active (non-revoked) devices for a user."
  def list_for_user(%User{id: user_id}) do
    from(d in LinkedDevice,
      where: d.user_id == ^user_id and is_nil(d.revoked_at),
      order_by: [desc: d.paired_at]
    )
    |> Repo.all()
  end

  @doc "Fetch a device by uuid scoped to a user (so user A can't see user B's)."
  def get_for_user(%User{id: user_id}, uuid) when is_binary(uuid) do
    case Repo.get_by(LinkedDevice, uuid: uuid, user_id: user_id) do
      nil -> {:error, :not_found}
      device -> {:ok, device}
    end
  end

  # ----- auth ------------------------------------------------------------

  @doc """
  Resolve a raw device token to `{:ok, {device, user}}` if active,
  `{:error, reason}` otherwise. Touches `last_seen_at` on success so
  the settings page can show "online 12s ago".
  """
  def authenticate_token(token) when is_binary(token) and byte_size(token) > 0 do
    hash = hash_token(token)

    query =
      from d in LinkedDevice,
        where: d.token_hash == ^hash and is_nil(d.revoked_at),
        preload: [:user]

    case Repo.one(query) do
      nil ->
        {:error, :invalid}

      %LinkedDevice{user: %{is_active: true} = user} = device ->
        touch(device)
        {:ok, {device, user}}

      %LinkedDevice{} ->
        {:error, :user_inactive}
    end
  end

  def authenticate_token(_), do: {:error, :missing}

  @doc """
  Update `last_seen_at` to now. Cheap; fire and forget.
  """
  def touch(%LinkedDevice{} = device) do
    device
    |> LinkedDevice.touch_changeset(%{last_seen_at: utc_now()})
    |> Repo.update()
  end

  # ----- mutate ----------------------------------------------------------

  @doc "Revoke a device. Forward-only — row stays for audit."
  def revoke(%User{} = user, uuid) when is_binary(uuid) do
    with {:ok, device} <- get_for_user(user, uuid) do
      result =
        device
        |> LinkedDevice.revoke_changeset(%{revoked_at: utc_now()})
        |> Repo.update()

      with {:ok, revoked} <- result do
        # Boot any open sockets / disconnect the channel.
        Endpoint.broadcast("device:#{revoked.uuid}", "revoked", %{})

        Backend.Broadcasts.entity_changed(
          "linked-device",
          revoked.uuid,
          revoked.company_id,
          "revoked"
        )

        {:ok, revoked}
      end
    end
  end

  @doc """
  Send a test ping to `device_uuid` belonging to `user`. Broadcast
  lands on `device:<uuid>` and the mobile shell renders it as a toast.
  """
  def send_ping(%User{} = user, device_uuid, message \\ "Ping from your laptop")
      when is_binary(device_uuid) do
    with {:ok, device} <- get_for_user(user, device_uuid) do
      Endpoint.broadcast!("device:#{device.uuid}", "ping", %{
        message: message,
        sent_at: DateTime.to_iso8601(utc_now())
      })

      {:ok, device}
    end
  end

  @doc """
  Push a navigate command to a single device. The mobile shell sees
  `navigate` on its `device:<uuid>` channel and `router.replace()`s
  to the given path. Restricted to `/m/*` paths so a stolen socket
  can't be used to redirect the device to an external URL.
  """
  def push_navigate(%User{} = user, device_uuid, path)
      when is_binary(device_uuid) and is_binary(path) do
    with :ok <- validate_navigate_path(path),
         {:ok, device} <- get_for_user(user, device_uuid) do
      Endpoint.broadcast!("device:#{device.uuid}", "navigate", %{
        path: path,
        sent_at: DateTime.to_iso8601(utc_now())
      })

      {:ok, device}
    end
  end

  @doc """
  Fan-out push_navigate to every active device the user owns. Used
  by the "Send expected POs to device" CTA so the planner can hit
  one button and have their phone(s) jump to `/m/incoming`.
  """
  def push_navigate_to_user(%User{} = user, path) when is_binary(path) do
    with :ok <- validate_navigate_path(path) do
      devices = list_for_user(user)
      sent_at = DateTime.to_iso8601(utc_now())

      Enum.each(devices, fn d ->
        Endpoint.broadcast!("device:#{d.uuid}", "navigate", %{
          path: path,
          sent_at: sent_at
        })
      end)

      {:ok, devices}
    end
  end

  defp validate_navigate_path(path) when is_binary(path) do
    cond do
      not String.starts_with?(path, "/m/") -> {:error, :unsafe_path}
      String.contains?(path, "..") -> {:error, :unsafe_path}
      true -> :ok
    end
  end

  defp validate_navigate_path(_), do: {:error, :unsafe_path}

  # ----- helpers ---------------------------------------------------------

  defp generate_token do
    :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
  end

  defp hash_token(token) when is_binary(token) do
    :crypto.hash(:sha256, token)
  end

  defp random_code do
    1..@code_length
    |> Enum.map(fn _ -> Enum.random(@code_alphabet) end)
    |> List.to_string()
  end

  defp normalise_code(nil), do: nil

  defp normalise_code(code) when is_binary(code) do
    code |> String.trim() |> String.upcase()
  end

  defp normalise_code(_), do: nil

  defp normalise_label(nil), do: ""
  defp normalise_label(label) when is_binary(label), do: String.trim(label)
  defp normalise_label(_), do: ""

  defp normalise_platform(nil), do: nil

  defp normalise_platform(p) when is_binary(p) do
    p = p |> String.trim() |> String.downcase()
    if p in LinkedDevice.platforms(), do: p, else: nil
  end

  defp normalise_platform(_), do: nil

  defp normalise_user_agent(nil), do: nil
  defp normalise_user_agent(ua) when is_binary(ua), do: String.slice(ua, 0, 500)
  defp normalise_user_agent(_), do: nil

  defp utc_now, do: DateTime.utc_now() |> DateTime.truncate(:second)
end
