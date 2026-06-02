export interface User {
  id: number;
  email: string;
  name: string;
  /** Base64 data URL or null. Returned by every user-facing endpoint
   *  (/me, /users, profile-update) since the compressed payload is
   *  small enough that a flat list of ~hundreds of users is fine. */
  avatar?: string | null;
  is_active: boolean;
  inserted_at: string;
}

export interface UserListEntry extends User {
  is_online: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}
