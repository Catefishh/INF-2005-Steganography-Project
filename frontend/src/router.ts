// Minimal History API router. Six screen paths plus two result paths.
//
// The app deliberately keeps every page mounted (see App.tsx) so that keys, files and
// passphrases carry between screens. The router therefore only decides *which* page is
// visible; it never unmounts anything.

import { useEffect, useState } from "react";
import type { Page } from "./util";

/** A screen either shows its form or, where it has one, its result. */
export type View = "form" | "result";

export interface Route {
  page: Page;
  view: View;
}

/** The canonical path of every screen. The label in the sidebar, the <h1> and this string match. */
export const PATHS: Record<Page, string> = {
  keys: "/keys",
  hide: "/embed",
  verify: "/verify",
  analyse: "/inspect",
  attacks: "/tamper-tests",
  text: "/text",
};

/** Only these two screens produce a result worth its own URL. */
const RESULT_PAGES: readonly Page[] = ["hide", "verify"];

export function hasResultView(page: Page): boolean {
  return RESULT_PAGES.includes(page);
}

export function pathFor(page: Page, view: View = "form"): string {
  const base = PATHS[page];
  return view === "result" && hasResultView(page) ? `${base}/result` : base;
}

/**
 * Turns a raw pathname into a screen. Unknown paths and "/" fall back to Keys while no key
 * pair exists, so a first-time user cannot start in the middle of the workflow, and to
 * Embed & Sign once there is a key pair.
 */
export function resolveRoute(pathname: string, hasKeys: boolean): Route {
  const clean = `/${pathname.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  for (const page of Object.keys(PATHS) as Page[]) {
    if (clean === PATHS[page]) return { page, view: "form" };
    if (hasResultView(page) && clean === `${PATHS[page]}/result`) return { page, view: "result" };
  }
  return { page: hasKeys ? "hide" : "keys", view: "form" };
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  // pushState/replaceState do not fire popstate. Dispatching it synchronously here can re-enter
  // React while the current render is still committing (e.g. a fallback effect that calls
  // navigate() while another effect from the same commit is about to read the old pathname).
  // Deferring to a microtask lets the current commit finish first.
  queueMicrotask(() => window.dispatchEvent(new PopStateEvent("popstate")));
}

/** Current pathname, kept in sync with Back, Forward and navigate(). */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  return pathname;
}

/** True when a click on a link should be handled by the router rather than the browser. */
export function isPlainLeftClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
