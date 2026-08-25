export interface NpdIntegrationConfig {
  readonly enabled: boolean;
  //: API origin (server-to-server: `POST /api/integration/…`).
  readonly base_url: string | null;
  //: Frontend origin (deep-links in the browser + ``/media/…`` file
  //: URLs). Distinct from ``base_url`` because Django and Next.js run
  //: on different ports in dev; may equal ``base_url`` in prod when
  //: they share a domain.
  readonly frontend_url: string | null;
  //: Never carries the actual token — the PSP payload projection sends
  //: a boolean instead so the settings form can show "token is set,
  //: retype to change" without decrypting the secret into the response.
  readonly has_token: boolean;
}

export interface NpdIntegrationTestResult {
  readonly ok: boolean;
  readonly in_development_count?: number;
  readonly reason?: string;
}
