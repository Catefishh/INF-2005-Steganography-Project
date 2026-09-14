import { useState } from "react";
import { Icon, type IconName } from "./components";
import { AnalysePage } from "./pages/AnalysePage";
import { AttackPage } from "./pages/AttackPage";
import { HidePage } from "./pages/HidePage";
import { KeysPage } from "./pages/KeysPage";
import { VerifyPage } from "./pages/VerifyPage";
import type { Handoff, Page, Vault } from "./util";

const PAGES: { id: Page; icon: IconName; label: string; role: string; title: string; subtitle: string }[] = [
  { id: "keys", icon: "key", label: "Keys", role: "Setup", title: "RSA signing keys",
    subtitle: "The sender signs with the private key; the receiver verifies with the public key." },
  { id: "hide", icon: "shield", label: "Embed & sign", role: "Party A", title: "Protect a cover object",
    subtitle: "Hash → sign → encrypt → hide with LSB replacement at a secured start location." },
  { id: "verify", icon: "eye", label: "Extract & verify", role: "Party B", title: "Verify a received file",
    subtitle: "Find the header → decrypt the start → extract → verify the signature → compare hashes." },
  { id: "analyse", icon: "layers", label: "Steganalysis", role: "Analyst", title: "Look for hidden data",
    subtitle: "Bit planes, histogram, chi-square test and difference image." },
  { id: "attacks", icon: "zap", label: "Attack lab", role: "Tester", title: "Negative test cases",
    subtitle: "Tampering, wrong keys, wrong passphrase, wrong start location, re-compression and forgery." },
];

const EMPTY_VAULT: Vault = { privatePem: "", publicPem: "", privateFingerprint: null, publicFingerprint: null, bits: null };

export default function App() {
  const [page, setPage] = useState<Page>("hide");
  const [vault, setVault] = useState<Vault>(EMPTY_VAULT);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const current = PAGES.find((item) => item.id === page) ?? PAGES[1];

  return (
    <div className="app">
      <aside className="rail">
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
        <nav>
          {PAGES.map((item) => (
            <button key={item.id} type="button" className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
              <Icon name={item.icon} />
              <span>
                <b>{item.label}</b>
                <small>{item.role}</small>
              </span>
              {item.id === "keys" && vault.privatePem && <i className="dot" title="Keys loaded" />}
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <span>SHA-256</span><span>RSA-PSS</span><span>AES-256-GCM</span><span>LSB 1-8</span>
          <p>INF2005 · Cyber Security Fundamentals</p>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">{current.role}</span>
            <h1>{current.title}</h1>
            <p>{current.subtitle}</p>
          </div>
          <div className="key-status">
            <Icon name="key" />
            <span>{vault.privatePem || vault.publicPem ? `RSA-${vault.bits ?? "?"} keys loaded` : "No keys loaded"}</span>
          </div>
        </header>
        <div hidden={page !== "keys"}><KeysPage vault={vault} setVault={setVault} /></div>
        <div hidden={page !== "hide"}><HidePage vault={vault} onHandoff={setHandoff} goTo={setPage} /></div>
        <div hidden={page !== "verify"}><VerifyPage vault={vault} handoff={handoff} /></div>
        <div hidden={page !== "analyse"}><AnalysePage handoff={handoff} /></div>
        <div hidden={page !== "attacks"}><AttackPage vault={vault} handoff={handoff} /></div>
      </main>
    </div>
  );
}
