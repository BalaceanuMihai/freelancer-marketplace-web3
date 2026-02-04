import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

import deployments from "../../blockchain/deployments/localhost.json";
import { FreelancerMarketplace__factory } from "../../blockchain/typechain-types/factories/contracts/FreelancerMarketplace.sol/FreelancerMarketplace__factory";

const RPC_URL = "http://127.0.0.1:8545";

function isPk(pk: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(pk.trim());
}
function short(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "-";
}

export default function App() {
  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), []);

  // Two wallets
  const [clientPk, setClientPk] = useState(() => sessionStorage.getItem("pk_client") ?? "");
  const [freePk, setFreePk] = useState(() => sessionStorage.getItem("pk_freelancer") ?? "");

  const [clientWallet, setClientWallet] = useState<ethers.Wallet | null>(null);
  const [freeWallet, setFreeWallet] = useState<ethers.Wallet | null>(null);

  const [clientAddr, setClientAddr] = useState("");
  const [freeAddr, setFreeAddr] = useState("");
  const [clientBal, setClientBal] = useState("");
  const [freeBal, setFreeBal] = useState("");

  // Job actions
  const [jobId, setJobId] = useState("0");
  const [jobDesc, setJobDesc] = useState("Build landing page");
  const [jobBudgetEth, setJobBudgetEth] = useState("0.05");

  const [status, setStatus] = useState("Ready.");
  const [busy, setBusy] = useState(false);

  const marketplaceAddress = deployments.marketplace;

  function loadClient() {
    const pk = clientPk.trim();
    if (!isPk(pk)) return setStatus("Client PK invalid.");
    const w = new ethers.Wallet(pk, provider);
    setClientWallet(w);
    sessionStorage.setItem("pk_client", pk);
    setStatus("Client wallet loaded ✅");
    void refresh();
  }

  function loadFreelancer() {
    const pk = freePk.trim();
    if (!isPk(pk)) return setStatus("Freelancer PK invalid.");
    const w = new ethers.Wallet(pk, provider);
    setFreeWallet(w);
    sessionStorage.setItem("pk_freelancer", pk);
    setStatus("Freelancer wallet loaded ✅");
    void refresh();
  }

  async function refresh() {
    try {
      if (clientWallet) {
        const a = await clientWallet.getAddress();
        setClientAddr(a);
        const b = await provider.getBalance(a);
        setClientBal(ethers.formatEther(b));
      }
      if (freeWallet) {
        const a = await freeWallet.getAddress();
        setFreeAddr(a);
        const b = await provider.getBalance(a);
        setFreeBal(ethers.formatEther(b));
      }
    } catch (e: any) {
      setStatus(e?.message ?? "Refresh failed");
    }
  }

  useEffect(() => {
    // auto-restore if valid
    if (isPk(clientPk)) {
      try {
        setClientWallet(new ethers.Wallet(clientPk.trim(), provider));
      } catch {}
    }
    if (isPk(freePk)) {
      try {
        setFreeWallet(new ethers.Wallet(freePk.trim(), provider));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientWallet, freeWallet]);

  async function createJobAsClient() {
    if (!clientWallet) return setStatus("Load client wallet first.");
    try {
      setBusy(true);
      setStatus("Client: creating job...");
      const mp = FreelancerMarketplace__factory.connect(marketplaceAddress, clientWallet);

      // ✅ Replace if your function name differs
      const tx = await mp.createJob(jobDesc, {
        value: ethers.parseEther(jobBudgetEth),
      });

      setStatus(`Pending: ${tx.hash.slice(0, 10)}...`);
      await tx.wait();
      await refresh();
      setStatus("Job created ✅ (funds deposited)");
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "createJob failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyAsFreelancer() {
    if (!freeWallet) return setStatus("Load freelancer wallet first.");
    try {
      setBusy(true);
      setStatus("Freelancer: applying to job...");
      const mp = FreelancerMarketplace__factory.connect(marketplaceAddress, freeWallet);

      // ✅ Replace if your function name differs
      const tx = await mp.applyForJob(BigInt(jobId));

      setStatus(`Pending: ${tx.hash.slice(0, 10)}...`);
      await tx.wait();
      setStatus("Applied ✅");
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "apply failed");
    } finally {
      setBusy(false);
    }
  }

  async function acceptFreelancerAsClient() {
    if (!clientWallet) return setStatus("Load client wallet first.");
    if (!freeAddr) return setStatus("Load freelancer wallet (so we know freelancer address).");
    try {
      setBusy(true);
      setStatus("Client: accepting freelancer...");
      const mp = FreelancerMarketplace__factory.connect(marketplaceAddress, clientWallet);

      // ✅ Replace if your function name differs
      const tx = await (mp as any).acceptFreelancer(BigInt(jobId), freeAddr);

      setStatus(`Pending: ${tx.hash.slice(0, 10)}...`);
      await tx.wait();
      setStatus("Freelancer accepted ✅ (escrow active)");
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "accept failed");
    } finally {
      setBusy(false);
    }
  }

  async function markCompletedAsFreelancer() {
    if (!freeWallet) return setStatus("Load freelancer wallet first.");
    try {
      setBusy(true);
      setStatus("Freelancer: marking completed...");
      const mp = FreelancerMarketplace__factory.connect(marketplaceAddress, freeWallet);

      // ✅ Replace if your function name differs
      const tx = await mp.markCompleted(BigInt(jobId));

      setStatus(`Pending: ${tx.hash.slice(0, 10)}...`);
      await tx.wait();
      setStatus("Marked completed ✅");
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "markCompleted failed");
    } finally {
      setBusy(false);
    }
  }

  async function releasePaymentAsClient() {
    if (!clientWallet) return setStatus("Load client wallet first.");
    try {
      setBusy(true);
      setStatus("Client: releasing payment...");
      const mp = FreelancerMarketplace__factory.connect(marketplaceAddress, clientWallet);

      // ✅ Replace if your function name differs
      const tx = await mp.releasePayment(BigInt(jobId));

      setStatus(`Pending: ${tx.hash.slice(0, 10)}...`);
      await tx.wait();
      await refresh();
      setStatus("Payment released ✅");
    } catch (e: any) {
      setStatus(e?.shortMessage ?? e?.message ?? "releasePayment failed");
    } finally {
      setBusy(false);
    }
  }

  const styles: Record<string, React.CSSProperties> = {
    page: {
      minHeight: "100vh",
      padding: "38px 18px",
      background:
        "radial-gradient(900px 520px at 12% 12%, rgba(34,197,94,0.18), transparent 60%)," +
        "radial-gradient(900px 520px at 88% 18%, rgba(59,130,246,0.20), transparent 60%)," +
        "linear-gradient(180deg, #070816 0%, #050616 100%)",
      color: "#e8eaf3",
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial',
    },
    container: { width: "100%", maxWidth: 1100, margin: "0 auto" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "end", gap: 14 },
    title: { margin: 0, fontSize: 28, letterSpacing: -0.5 },
    subtitle: { marginTop: 6, color: "rgba(232,234,243,0.72)", fontSize: 14 },
    grid: { display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14, marginTop: 16 },
    card: {
      borderRadius: 18,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.06)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 18px 44px rgba(0,0,0,0.40)",
      padding: 16,
    },
    half: { gridColumn: "span 6" },
    full: { gridColumn: "span 12" },
    label: { fontSize: 12, color: "rgba(232,234,243,0.72)", marginBottom: 6, display: "block" },
    input: {
      width: "100%",
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(12,16,31,0.60)",
      color: "#e8eaf3",
      outline: "none",
    },
    row: { display: "grid", gridTemplateColumns: "1fr 160px", gap: 10, alignItems: "end" },
    btn: {
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "linear-gradient(180deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))",
      color: "white",
      cursor: "pointer",
      fontWeight: 800,
      boxShadow: "0 14px 26px rgba(37,99,235,0.22)",
    },
    btn2: {
      padding: "11px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "linear-gradient(180deg, rgba(34,197,94,0.95), rgba(22,163,74,0.95))",
      color: "white",
      cursor: "pointer",
      fontWeight: 800,
      boxShadow: "0 14px 26px rgba(22,163,74,0.18)",
    },
    disabled: { opacity: 0.55, cursor: "not-allowed" },
    mono: {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      color: "rgba(232,234,243,0.82)",
      wordBreak: "break-all",
    },
    stat: {
      marginTop: 14,
      padding: "12px 14px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(0,0,0,0.32)",
      color: "rgba(232,234,243,0.86)",
      fontSize: 13,
      whiteSpace: "pre-wrap",
    },
  };

  const b1 = busy ? { ...styles.btn, ...styles.disabled } : styles.btn;
  const b2 = busy ? { ...styles.btn2, ...styles.disabled } : styles.btn2;

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Freelancer Marketplace – Demo Flow</h1>
            <div style={styles.subtitle}>
              Client deposits funds → Freelancer applies → Accept → Complete → Release payment.
            </div>
          </div>
          <div style={styles.mono}>RPC {RPC_URL}</div>
        </div>

        <div style={styles.grid}>
          {/* CLIENT */}
          <div style={{ ...styles.card, ...styles.half }}>
            <h3 style={{ marginTop: 0 }}>Client</h3>
            <label style={styles.label}>Client Private Key</label>
            <input style={styles.input} value={clientPk} onChange={(e) => setClientPk(e.target.value)} placeholder="0x..." />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={loadClient} disabled={busy} style={b2}>Load Client</button>
              <button onClick={refresh} disabled={busy} style={b1}>Refresh</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Address</div>
              <div style={styles.mono}>{clientAddr ? short(clientAddr) : "-"}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Balance</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{clientBal ? `${Number(clientBal).toFixed(4)} ETH` : "-"}</div>
            </div>
          </div>

          {/* FREELANCER */}
          <div style={{ ...styles.card, ...styles.half }}>
            <h3 style={{ marginTop: 0 }}>Freelancer</h3>
            <label style={styles.label}>Freelancer Private Key</label>
            <input style={styles.input} value={freePk} onChange={(e) => setFreePk(e.target.value)} placeholder="0x..." />
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button onClick={loadFreelancer} disabled={busy} style={b2}>Load Freelancer</button>
              <button onClick={refresh} disabled={busy} style={b1}>Refresh</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Address</div>
              <div style={styles.mono}>{freeAddr ? short(freeAddr) : "-"}</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>Balance</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{freeBal ? `${Number(freeBal).toFixed(4)} ETH` : "-"}</div>
            </div>
          </div>

          {/* ACTIONS */}
          <div style={{ ...styles.card, ...styles.full }}>
            <h3 style={{ marginTop: 0 }}>Job Flow</h3>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", gap: 10 }}>
              <div>
                <label style={styles.label}>Job description</label>
                <input style={styles.input} value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} />
              </div>
              <div>
                <label style={styles.label}>Budget (ETH)</label>
                <input style={styles.input} value={jobBudgetEth} onChange={(e) => setJobBudgetEth(e.target.value)} />
              </div>
              <div>
                <label style={styles.label}>Job ID</label>
                <input style={styles.input} value={jobId} onChange={(e) => setJobId(e.target.value)} />
              </div>
            </div>

            <div style={{ height: 12 }} />

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button onClick={createJobAsClient} disabled={busy || !clientWallet} style={b2}>1) Client: Create Job</button>
              <button onClick={applyAsFreelancer} disabled={busy || !freeWallet} style={b1}>2) Freelancer: Apply</button>
              <button onClick={acceptFreelancerAsClient} disabled={busy || !clientWallet || !freeAddr} style={b2}>3) Client: Accept</button>
              <button onClick={markCompletedAsFreelancer} disabled={busy || !freeWallet} style={b1}>4) Freelancer: Mark Completed</button>
              <button onClick={releasePaymentAsClient} disabled={busy || !clientWallet} style={b2}>5) Client: Release Payment</button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Marketplace: <span style={styles.mono}>{marketplaceAddress}</span>
            </div>
          </div>

          <div style={{ ...styles.stat, ...styles.full }}>
            <b>Status:</b> {status}
          </div>
        </div>
      </div>
    </div>
  );
}
