defmodule Backend.Accounts.Notifier do
  @moduledoc """
  Builds and dispatches transactional emails for the Accounts boundary.

  In dev the Swoosh local adapter delivers to `/dev/mailbox`. In
  production we'll swap the adapter to Azure Communication Services
  (same provider vita-cff uses) via `config/runtime.exs`.
  """

  import Swoosh.Email
  alias Backend.Mailer

  @from {"PSP", "no-reply@vitamanufacture.co.uk"}

  def deliver_confirmation(user, confirm_url) do
    body = """
    Hi #{user.name},

    Welcome to PSP. Please confirm your email by clicking the link
    below — it expires in 24 hours and can only be used once.

    #{confirm_url}

    If you didn't request this account, ignore this email.

    — PSP
    """

    new()
    |> to({user.name, user.email})
    |> from(@from)
    |> subject("Confirm your PSP account")
    |> text_body(body)
    |> Mailer.deliver()
  end

  def deliver_password_reset(user, reset_url) do
    body = """
    Hi #{user.name},

    We received a request to reset your PSP password. Click the link
    below to choose a new one — it expires in 1 hour and can only be
    used once.

    #{reset_url}

    If you didn't ask for this, you can safely ignore this email —
    your password won't be changed.

    — PSP
    """

    new()
    |> to({user.name, user.email})
    |> from(@from)
    |> subject("Reset your PSP password")
    |> text_body(body)
    |> Mailer.deliver()
  end

  @doc """
  Sent after any successful password change — both the "I changed it
  myself" path and the reset-via-token path. Gives the user a fighting
  chance to spot an account takeover.
  """
  def deliver_password_changed(user) do
    now = DateTime.utc_now() |> Calendar.strftime("%Y-%m-%d %H:%M UTC")

    body = """
    Hi #{user.name},

    Your PSP password was just changed at #{now}.

    If this was you, no action is needed.

    If it wasn't, your account may have been compromised. Reply to
    this email immediately so we can secure it.

    — PSP
    """

    new()
    |> to({user.name, user.email})
    |> from(@from)
    |> subject("Your PSP password was changed")
    |> text_body(body)
    |> Mailer.deliver()
  end
end
