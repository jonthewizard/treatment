import type { ProjectState } from "@/types";

const KEY = "mvt:project";

export function saveProject(state: ProjectState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

export function loadProject(): ProjectState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
