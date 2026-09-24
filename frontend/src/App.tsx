import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Icon, Reveal, type IconName } from "./components";
import { Sidebar, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { AnalysePage } from "./pages/AnalysePage";
import { AttackPage } from "./pages/AttackPage";
import { HidePage } from "./pages/HidePage";
import { KeysPage } from "./pages/KeysPage";
import { VerifyPage } from "./pages/VerifyPage";
import { TextPage } from "./pages/TextPage";
import { isPlainLeftClick, navigate, pathFor, resolveRoute, usePathname } from "./router";
import type { Handoff, Page, Vault } from "./util";

type Group = "Set up" | "Send and receive" | "Examine";

/** The sidebar label, the page heading and the URL are the same string for every screen. */
const PAGES: { id: Page; icon: IconName; label: string; role: string; group: Group; lede: string }[] = [
  { id: "keys", icon: "key", label: "Keys", role: "Start here", group: "Set up",
    lede: "You need one key pair before you can embed or verify a file. It takes one click." },
  { id: "hide", icon: "shield", label: "Embed & Sign", role: "Sender", group: "Send and receive",
    lede: "Hide a message or a file inside a picture or a sound clip, and sign it so the receiver can tell it came from you." },
  { id: "verify", icon: "eye", label: "Extract & Verify", role: "Receiver", group: "Send and receive",
    lede: "Find out whether a file you received really came from the person who claims to have sent it, and read what is inside." },
  { id: "text", icon: "eye", label: "Text Steganography", role: "Sender and receiver", group: "Send and receive",
    lede: "Hide a signed, encrypted message in acrostics, whitespace, or zero-width text." },
  { id: "analyse", icon: "layers", label: "Inspect a file", role: "Analyst", group: "Examine",
    lede: "Look for signs that something is hidden in a file, without needing the password or any key." },
  { id: "attacks", icon: "zap", label: "Tamper tests", role: "Tester", group: "Examine",
    lede: "Damage a protected file ten different ways and confirm the checker catches every one. Each damaged file can be saved." },
];

const GROUPS: Group[] = ["Set up", "Send and receive", "Examine"];

const EMPTY_VAULT: Vault = { privatePem: "", publicPem: "", privateFingerprint: null, publicFingerprint: null, bits: null };

export default function App() {
  const [vault, setVault] = useState<Vault>(EMPTY_VAULT);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [workspaceDigest, setWorkspaceDigest] = useState("");
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastPageRef = useRef<Page | null>(null);

  const pathname = usePathname();
  const hasKeys = Boolean(vault.privatePem || vault.publicPem);
  const route = resolveRoute(pathname, hasKeys);
  const current = PAGES.find((item) => item.id === route.page) ?? PAGES[0];

  useEffect(() => {
    const file = handoff?.stego;
    if (!file) { setWorkspaceDigest(""); return; }
    let live = true;
    file.arrayBuffer().then((bytes) => crypto.subtle.digest("SHA-256", bytes))
      .then((digest) => { if (live) setWorkspaceDigest(Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("")); })
      .catch(() => { if (live) setWorkspaceDigest(""); });
    return () => { live = false; };
  }, [handoff?.id]);

  function replaceWorkingFile(file: File | null) {
    setHandoff(file ? { id: crypto.randomUUID(), stego: file, cover: null,
      passphrase: "", publicPem: vault.publicPem, serial: Date.now() } : null);
    if (!file) setWorkspaceEpoch((value) => value + 1);
  }

  useEffect(() => {
    if (lastPageRef.current !== null && lastPageRef.current !== route.page) headingRef.current?.focus();
    lastPageRef.current = route.page;
  }, [route.page]);

  // Keep the address bar honest: rewrite "/", trailing slashes and unknown paths to the
  // canonical path of the screen actually on show. Compares against the *current* pathname
  // rather than the one this render committed with — navigate() defers its popstate
  // notification by a microtask, so a navigate() call from another effect in the same commit
  // (e.g. HidePage falling back from a result with nothing in memory) can land on
  // window.location before this effect's own `route` has caught up. Reading route fresh here
  // stops that from being mistaken for a mismatch and "corrected" back.
  useEffect(() => {
    const live = resolveRoute(window.location.pathname, hasKeys);
    const canonical = pathFor(live.page, live.view);
    if (window.location.pathname !== canonical) navigate(canonical, { replace: true });
  }, [pathname, hasKeys]);

  function goTo(page: Page): void {
    navigate(pathFor(page));
    setMenuOpen(false);
  }

  /**
   * Moves a screen between its form and its result. Showing a result pushes an entry so Back
   * returns to the form; going back to the form replaces it, so the two do not stack up.
   */
  const showEmbedResult = useCallback((show: boolean) => {
    navigate(pathFor("hide", show ? "result" : "form"), { replace: !show });
  }, []);

  const showVerifyResult = useCallback((show: boolean) => {
    navigate(pathFor("verify", show ? "result" : "form"), { replace: !show });
  }, []);

  return (
    <MotionConfig reducedMotion="user"><SidebarProvider>
      <Sidebar className={menuOpen ? "menu-open" : ""}>
        <div className="rail-head">
          <SidebarTrigger><Icon name="menu" size={18} /></SidebarTrigger>
          <button type="button" className="rail-toggle" aria-expanded={menuOpen} aria-controls="rail-nav"
            aria-label={menuOpen ? "Close the menu" : "Open the menu"} onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name={menuOpen ? "x" : "menu"} size={20} />
          </button>
          <div className="brand">
            <svg className="brand-wave" viewBox="0 0 120 32" aria-hidden="true">
              <path d="M0 16 C10 4 20 28 30 16 S50 4 60 16 80 28 90 16 110 4 120 16" />
              <path className="alt" d="M0 16 C10 26 20 6 30 16 S50 26 60 16 80 6 90 16 110 26 120 16" />
            </svg>
            <div>
              <strong>STEGLOC</strong>
              <span>LSB integrity workbench</span>
            </div>
          </div>
          <span className={`rail-keys${hasKeys ? " ready" : ""}`}>
            {hasKeys ? <Icon name="check" size={12} /> : <Icon name="alert" size={12} />}
            {hasKeys ? "keys ready" : "keys needed"}
          </span>
        </div>

        <nav id="rail-nav" aria-label="Screens">
          {GROUPS.map((group) => (
            <Fragment key={group}>
              <span className="nav-group">{group}</span>
              <SidebarMenu>
              {PAGES.filter((item) => item.group === group).map((item) => (
                <SidebarMenuItem key={item.id} href={pathFor(item.id)} title={item.label} className={route.page === item.id ? "active" : ""}
                  aria-current={route.page === item.id ? "page" : undefined}
                  onClick={(event) => {
                    if (!isPlainLeftClick(event)) return;
                    event.preventDefault();
                    goTo(item.id);
                  }}>
                  <Icon name={item.icon} />
                  <span>
                    <b>{item.label}</b>
                    <small>{item.role}</small>
                  </span>
                  {item.id === "keys" && (
                    <span className={`nav-state${hasKeys ? " ready" : ""}`}>
                      {hasKeys && <Icon name="check" size={12} />}
                      {hasKeys ? "READY" : "NEEDED"}
                    </span>
                  )}
                </SidebarMenuItem>
              ))}
              </SidebarMenu>
            </Fragment>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="tech">
            <span>SHA-256</span><span>RSA-PSS</span><span>AES-256-GCM</span><span>LSB 1-8</span>
          </div>
          <p>INF2005 · Cyber Security Fundamentals</p>
        </div>
      </Sidebar>

      <SidebarInset>
        <motion.header key={route.page} className="topbar" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} transition={{duration: 0.2}}>
          <div>
            <span className="topbar-context">{current.group} <span aria-hidden="true">/</span> {current.role}</span>
            <h1 ref={headingRef} tabIndex={-1}>{current.label}</h1>
            <p>{current.lede}</p>
          </div>
        </motion.header>
        <AnimatePresence initial={false}>{handoff && <motion.section className="working-strip" role="status"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
          <div><b>Working file</b> <span>{handoff.stego.name} · {handoff.stego.name.split(".").pop()?.toUpperCase()} · {(handoff.stego.size / 1024).toFixed(1)} KiB</span>
            {handoff.sourceCover && handoff.sourceCover !== handoff.cover && <span>Prepared from {handoff.sourceCover.name}</span>}
            <code title={workspaceDigest}>{workspaceDigest || "Calculating SHA-256…"}</code></div>
          <label className="btn ghost sm">Replace file<input type="file" hidden onChange={(event) => replaceWorkingFile(event.target.files?.[0] ?? null)} /></label>
          <button className="btn ghost sm" type="button" onClick={() => replaceWorkingFile(null)}>Clear workspace</button>
        </motion.section>}</AnimatePresence>
        <Reveal hidden={route.page !== "keys"}><KeysPage vault={vault} setVault={setVault} goTo={goTo} /></Reveal>
        <Reveal hidden={route.page !== "text"}><TextPage key={workspaceEpoch} /></Reveal>
        <Reveal hidden={route.page !== "hide"}>
          <HidePage key={workspaceEpoch} vault={vault} onHandoff={setHandoff} goTo={goTo}
            showResult={route.page === "hide" && route.view === "result"}
            onShowResult={showEmbedResult} />
        </Reveal>
        <Reveal hidden={route.page !== "verify"}>
          <VerifyPage key={workspaceEpoch} vault={vault} handoff={handoff} onWorkingFile={replaceWorkingFile} goTo={goTo}
            showResult={route.page === "verify" && route.view === "result"}
            onShowResult={showVerifyResult} />
        </Reveal>
        <Reveal hidden={route.page !== "analyse"}><AnalysePage key={workspaceEpoch} handoff={handoff} onWorkingFile={replaceWorkingFile} /></Reveal>
        <Reveal hidden={route.page !== "attacks"}><AttackPage key={workspaceEpoch} vault={vault} handoff={handoff} onWorkingFile={replaceWorkingFile} onHandoff={setHandoff} goTo={goTo} /></Reveal>
      </SidebarInset>
    </SidebarProvider></MotionConfig>
  );
}
