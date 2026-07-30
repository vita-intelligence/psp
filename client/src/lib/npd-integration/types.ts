export interface NpdIntegrationConfig {
  readonly enabled: boolean;
  readonly base_url: string | null;
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
