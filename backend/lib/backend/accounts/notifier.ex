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
end
