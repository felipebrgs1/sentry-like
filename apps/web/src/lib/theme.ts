/**
 * Tema claro/escuro (Fase 10). O CSS já define :root (light) e .dark —
 * aqui só controlamos a classe no <html> + persistência.
 */

export type Theme = "dark" | "light";

const KEY = "sentrylike_theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // localStorage indisponível — segue sem persistir
  }
}

/** Aplica o tema salvo antes do primeiro render (evita flash). */
export function initTheme(): Theme {
  const t = getStoredTheme();
  applyTheme(t);
  return t;
}
