export interface User {
  id: number;
  email: string;
  name: string;
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
