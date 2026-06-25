import "server-only";
import { api } from "../api";
import { getSessionToken } from "../auth/server";
import type { ProjectSummary } from "../types";

export async function listProjects(): Promise<ProjectSummary[] | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { items } = await api<{ items: ProjectSummary[] }>("/api/projects", {
      token,
      cache: "no-store",
    });
    return items;
  } catch {
    return null;
  }
}
