
import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract, ethers } from "ethers";
import "./App.css";
import deployments from "../../blockchain/deployments/localhost.json";
import marketplaceArtifact from "../../blockchain/artifacts/contracts/FreelancerMarketplace.sol/FreelancerMarketplace.json";

const RPC_URL = "http://127.0.0.1:8545";
const CHAIN_ID = Number(deployments.chainId);
const MARKETPLACE_ADDRESS = deployments.marketplace;
const ZERO_ADDRESS = ethers.ZeroAddress.toLowerCase();
const MAX_VISIBLE_JOBS = 50;

const REMEMBER_WALLET_KEY = "worklane.metamask.reconnect";
const HARDHAT_CHAIN_HEX = `0x${CHAIN_ID.toString(16)}`;

type Workspace = "client" | "freelancer";
type Action = "create" | "apply" | "complete" | "release" | "cancel";
type Tone = "info" | "success" | "error" | "pending";

type Status = {
  tone: Tone;
  message: string;
};

type Job = {
  id: number;
  client: string;
  freelancer: string;
  description: string;
  priceEth: string;
  completed: boolean;
  paid: boolean;
  cancelled: boolean;
};

type InjectedProvider = ethers.Eip1193Provider & {
  on?: (
    event: string,
    listener: (...args: unknown[]) => void
  ) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void
  ) => void;
};

function injectedWallet(): InjectedProvider | undefined {
  return (
    window as Window & { ethereum?: InjectedProvider }
  ).ethereum;
}

async function ensureHardhatNetwork(
  ethereum: InjectedProvider
): Promise<void> {
  const current = String(
    await ethereum.request({ method: "eth_chainId" })
  );

  if (current.toLowerCase() === HARDHAT_CHAIN_HEX) {
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN_HEX }],
    });
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? Number(error.code)
        : undefined;

    if (code !== 4902) throw error;

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: HARDHAT_CHAIN_HEX,
          chainName: "Hardhat Local",
          rpcUrls: [RPC_URL],
          nativeCurrency: {
            name: "Ether",
            symbol: "ETH",
            decimals: 18,
          },
        },
      ],
    });

    const afterAdd = String(
      await ethereum.request({ method: "eth_chainId" })
    );

    if (afterAdd.toLowerCase() !== HARDHAT_CHAIN_HEX) {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: HARDHAT_CHAIN_HEX }],
      });
    }
  }

  const selected = String(
    await ethereum.request({ method: "eth_chainId" })
  );

  if (selected.toLowerCase() !== HARDHAT_CHAIN_HEX) {
    throw new Error(
      `Select Hardhat Local (chain ${CHAIN_ID}) in MetaMask.`
    );
  }
}

function truncate(
  value: string,
  start = 7,
  end = 5
): string {
  return value
    ? `${value.slice(0, start)}…${value.slice(-end)}`
    : "—";
}

function errorMessage(
  error: unknown,
  fallback: string
): string {
  if (typeof error === "object" && error !== null) {
    if (
      "shortMessage" in error &&
      typeof error.shortMessage === "string"
    ) {
      return error.shortMessage;
    }

    if (
      "message" in error &&
      typeof error.message === "string"
    ) {
      return error.message;
    }
  }

  return typeof error === "string" ? error : fallback;
}

function statusForJob(job: Job): string {
  if (job.cancelled) return "Cancelled";
  if (job.paid) return "Paid";
  if (job.completed) return "Awaiting payment";

  if (job.freelancer.toLowerCase() !== ZERO_ADDRESS) {
    return "In progress";
  }

  return "Open";
}

function Icon({
  name,
  size = 19,
}: {
  name:
    | "grid"
    | "wallet"
    | "layers"
    | "arrow"
    | "refresh"
    | "shield"
    | "check"
    | "bolt"
    | "logout"
    | "briefcase";
  size?: number;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="3" />
        <path d="M3 9h18M16 14h2" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3-9 5 9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M5.8 9A7 7 0 0 1 18.6 7L20 12M4 12l1.4 5A7 7 0 0 0 18.2 15" />
      </>
    ),
    shield: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l0-8Z" />,
    logout: (
      <>
        <path d="M9 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4m7 13 5-5-5-5M21 12H9" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18" />
      </>
    ),
  }[name];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...common}
    >
      {paths}
    </svg>
  );
}

function JobCard({
  job,
  action,
  disabled,
  onAction,
}: {
  job: Job;
  action?: { label: string; kind: Action };
  disabled: boolean;
  onAction: (action: Action, id: number) => void;
}) {
  const status = statusForJob(job);

  const statusClass =
    status === "Cancelled"
      ? ""
      : status === "Open"
        ? "job-card__status--open"
        : status === "Paid"
          ? "job-card__status--paid"
          : "job-card__status--active";

  const amountLabel = job.cancelled
    ? "net refunded"
    : job.paid
      ? "net paid"
      : "net escrow";

  return (
    <article className="job-card">
      <div className="job-card__top">
        <span className="job-card__id">
          PROJECT #{job.id}
        </span>

        <span
          className={`job-card__status ${statusClass}`}
        >
          {status}
        </span>
      </div>

      <h3>{job.description}</h3>

      <div className="job-card__meta">
        <span>
          <b>
            {Number(job.priceEth).toLocaleString(
              "en-US",
              { maximumFractionDigits: 4 }
            )}{" "}
            ETH
          </b>{" "}
          {amountLabel}
        </span>

        <span>
          Client{" "}
          <code title={job.client}>
            {truncate(job.client)}
          </code>
        </span>

        {job.freelancer.toLowerCase() !== ZERO_ADDRESS && (
          <span>
            Freelancer{" "}
            <code title={job.freelancer}>
              {truncate(job.freelancer)}
            </code>
          </span>
        )}
      </div>

      {action && (
        <button
          type="button"
          className="button button--outline"
          onClick={() => onAction(action.kind, job.id)}
          disabled={disabled}
        >
          {action.label}
          <Icon name="arrow" size={16} />
        </button>
      )}
    </article>
  );
}

function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__symbol">✳</div>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

export default function App() {
  const rpcProvider = useMemo(
    () => new ethers.JsonRpcProvider(RPC_URL),
    []
  );

  const [workspace, setWorkspace] = useState<Workspace>(
    () =>
      window.location.hash === "#freelancer"
        ? "freelancer"
        : "client"
  );

  const [signer, setSigner] =
    useState<ethers.Signer | null>(null);

  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("");

  const [networkOnline, setNetworkOnline] =
    useState<boolean | null>(null);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobCount, setJobCount] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);

  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("0.05");

  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastTx, setLastTx] = useState("");

  const [status, setStatus] = useState<Status>({
    tone: "info",
    message:
      "Connect MetaMask once to use both workspaces.",
  });

  const navigate = useCallback((target: Workspace) => {
    window.location.hash = target;
    setWorkspace(target);
  }, []);

  useEffect(() => {
    const onHashChange = () =>
      setWorkspace(
        window.location.hash === "#freelancer"
          ? "freelancer"
          : "client"
      );

    window.addEventListener("hashchange", onHashChange);

    return () =>
      window.removeEventListener(
        "hashchange",
        onHashChange
      );
  }, []);

  useEffect(() => {
    window.sessionStorage.removeItem("pk_client");
    window.sessionStorage.removeItem("pk_freelancer");

    const ethereum = injectedWallet();
    if (!ethereum) return;

    let mounted = true;
    let syncVersion = 0;

    async function syncWallet() {
      const version = ++syncVersion;

      if (
        !ethereum ||
        window.localStorage.getItem(
          REMEMBER_WALLET_KEY
        ) !== "yes"
      ) {
        return;
      }

      try {
        const accounts = await ethereum.request({
          method: "eth_accounts",
        });

        if (
          !Array.isArray(accounts) ||
          accounts.length === 0
        ) {
          window.localStorage.removeItem(
            REMEMBER_WALLET_KEY
          );

          if (mounted && version === syncVersion) {
            setSigner(null);
            setAddress("");
            setBalance("");

            setStatus({
              tone: "info",
              message:
                "MetaMask is disconnected. Connect again to continue.",
            });
          }

          return;
        }

        const chainId = String(
          await ethereum.request({
            method: "eth_chainId",
          })
        );

        if (
          chainId.toLowerCase() !== HARDHAT_CHAIN_HEX
        ) {
          if (mounted && version === syncVersion) {
            setSigner(null);
            setAddress("");
            setBalance("");

            setStatus({
              tone: "error",
              message:
                `MetaMask is on another network. ` +
                `Press Connect MetaMask to switch to ` +
                `Hardhat Local (${CHAIN_ID}).`,
            });
          }

          return;
        }

        const provider = new ethers.BrowserProvider(
          ethereum
        );

        const nextSigner = await provider.getSigner();
        const nextAddress =
          await nextSigner.getAddress();

        if (
          mounted &&
          version === syncVersion &&
          window.localStorage.getItem(
            REMEMBER_WALLET_KEY
          ) === "yes"
        ) {
          setSigner(nextSigner);
          setAddress(nextAddress);

          setStatus({
            tone: "success",
            message:
              `MetaMask connected: ` +
              `${truncate(nextAddress)}. ` +
              `Both workspaces use this wallet.`,
          });
        }
      } catch (error: unknown) {
        if (mounted && version === syncVersion) {
          setStatus({
            tone: "error",
            message: errorMessage(
              error,
              "Could not restore MetaMask connection."
            ),
          });
        }
      }
    }

    const walletChanged = () => {
      ++syncVersion;

      setSigner(null);
      setAddress("");
      setBalance("");

      void syncWallet();
    };

    ethereum.on?.("accountsChanged", walletChanged);
    ethereum.on?.("chainChanged", walletChanged);

    void syncWallet();

    return () => {
      mounted = false;
      ++syncVersion;

      ethereum.removeListener?.(
        "accountsChanged",
        walletChanged
      );

      ethereum.removeListener?.(
        "chainChanged",
        walletChanged
      );
    };
  }, []);

  const refresh = useCallback(async () => {
    setJobsLoading(true);

    try {
      const network = await rpcProvider.getNetwork();

      if (Number(network.chainId) !== CHAIN_ID) {
        throw new Error(
          `Expected Hardhat chain ${CHAIN_ID}.`
        );
      }

      const code = await rpcProvider.getCode(
        MARKETPLACE_ADDRESS
      );

      if (code === "0x") {
        throw new Error(
          "Marketplace not deployed on this local node. Run the deploy script."
        );
      }

      setNetworkOnline(true);

      const readContract = new Contract(
        MARKETPLACE_ADDRESS,
        marketplaceArtifact.abi,
        rpcProvider
      );

      const count = Number(
        await readContract.nextJobId()
      );

      setJobCount(count);

      const ids = Array.from(
        {
          length: Math.min(
            count,
            MAX_VISIBLE_JOBS
          ),
        },
        (_, index) => count - index - 1
      );

      const results: Job[] = await Promise.all(
        ids.map(async (id) => {
          const job = await readContract.jobs(id);

          return {
            id,
            client: String(job.client),
            freelancer: String(job.freelancer),
            description: String(job.description),
            priceEth: ethers.formatEther(job.price),
            completed: Boolean(job.completed),
            paid: Boolean(job.paid),
            cancelled: Boolean(job.cancelled),
          };
        })
      );

      setJobs(results);

      if (signer) {
        const walletAddress =
          await signer.getAddress();

        setAddress(walletAddress);

        const walletProvider =
          signer.provider ?? rpcProvider;

        setBalance(
          ethers.formatEther(
            await walletProvider.getBalance(
              walletAddress
            )
          )
        );
      } else {
        setAddress("");
        setBalance("");
      }
    } catch (error: unknown) {
      setNetworkOnline(false);
      setJobs([]);
      setJobCount(0);

      setStatus({
        tone: "error",
        message: errorMessage(
          error,
          "Could not reach the local blockchain."
        ),
      });
    } finally {
      setJobsLoading(false);
    }
  }, [rpcProvider, signer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function connectMetaMask() {
    const ethereum = injectedWallet();

    if (!ethereum) {
      setStatus({
        tone: "error",
        message:
          "MetaMask was not detected. Install the MetaMask browser extension and reload Worklane.",
      });

      return;
    }

    if (connecting || busy) return;

    try {
      setConnecting(true);

      setStatus({
        tone: "pending",
        message:
          "Waiting for MetaMask connection approval…",
      });

      await ethereum.request({
        method: "eth_requestAccounts",
      });

      setStatus({
        tone: "pending",
        message:
          "Checking the Hardhat Local network in MetaMask…",
      });

      await ensureHardhatNetwork(ethereum);

      const browserProvider =
        new ethers.BrowserProvider(ethereum);

      const nextSigner =
        await browserProvider.getSigner();

      const nextAddress =
        await nextSigner.getAddress();

      window.localStorage.setItem(
        REMEMBER_WALLET_KEY,
        "yes"
      );

      setSigner(nextSigner);
      setAddress(nextAddress);

      setStatus({
        tone: "success",
        message:
          `MetaMask connected: ${truncate(nextAddress)}. ` +
          "Switch freely between Client and Freelancer.",
      });
    } catch (error: unknown) {
      setSigner(null);
      setAddress("");
      setBalance("");

      setStatus({
        tone: "error",
        message: errorMessage(
          error,
          "Could not connect MetaMask. Approve the request and try again."
        ),
      });
    } finally {
      setConnecting(false);
    }
  }

  function disconnectWallet() {
    window.localStorage.removeItem(
      REMEMBER_WALLET_KEY
    );

    setSigner(null);
    setAddress("");
    setBalance("");

    setStatus({
      tone: "info",
      message:
        "Disconnected from Worklane. You can reconnect with MetaMask at any time.",
    });
  }

  async function execute(
    action: Action,
    selectedJobId?: number
  ) {
    if (!signer) {
      setStatus({
        tone: "error",
        message:
          "Connect a wallet before submitting a transaction.",
      });

      return;
    }

    if (busy) return;

    try {
      setBusy(true);

      setStatus({
        tone: "pending",
        message:
          "Preparing transaction on Hardhat Local…",
      });

      const ethereum = injectedWallet();

      if (!ethereum) {
        throw new Error(
          "MetaMask is unavailable. Reconnect your wallet."
        );
      }

      const walletChainId = String(
        await ethereum.request({
          method: "eth_chainId",
        })
      );

      if (
        walletChainId.toLowerCase() !==
        HARDHAT_CHAIN_HEX
      ) {
        throw new Error(
          `Switch MetaMask to Hardhat Local (chain ${CHAIN_ID}) before sending a transaction.`
        );
      }

      const accounts = await ethereum.request({
        method: "eth_accounts",
      });

      const activeAddress =
        await signer.getAddress();

      if (
        !Array.isArray(accounts) ||
        typeof accounts[0] !== "string" ||
        accounts[0].toLowerCase() !==
          activeAddress.toLowerCase()
      ) {
        throw new Error(
          "Your MetaMask account changed. Reconnect before submitting the transaction."
        );
      }

      const deployedCode =
        await rpcProvider.getCode(
          MARKETPLACE_ADDRESS
        );

      if (deployedCode === "0x") {
        throw new Error(
          "Marketplace contract is missing. Deploy it on localhost."
        );
      }

      const contract = new Contract(
        MARKETPLACE_ADDRESS,
        marketplaceArtifact.abi,
        signer
      );

      let tx: ethers.ContractTransactionResponse;

      if (action === "create") {
        if (!description.trim()) {
          throw new Error(
            "Add a project description first."
          );
        }

        const amount = ethers.parseEther(
          budget.trim()
        );

        if (amount <= 0n) {
          throw new Error(
            "Budget must be greater than zero."
          );
        }

        tx = await contract.createJob(
          description.trim(),
          { value: amount }
        );
      } else {
        if (selectedJobId === undefined) {
          throw new Error(
            "Select a job first."
          );
        }

        const id = BigInt(selectedJobId);

        if (action === "apply") {
          tx = await contract.applyForJob(id);
        } else if (action === "complete") {
          tx = await contract.markCompleted(id);
        } else if (action === "cancel") {
          tx = await contract.cancelJob(id);
        } else {
          tx = await contract.releasePayment(id);
        }
      }

      setLastTx(tx.hash);

      setStatus({
        tone: "pending",
        message:
          `Transaction ${truncate(tx.hash, 12, 7)} sent. ` +
          "Waiting for confirmation…",
      });

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error(
          "Transaction was not confirmed successfully."
        );
      }

      const messages: Record<Action, string> = {
        create:
          "Project created. The net payment is secured in escrow.",
        apply:
          "Application confirmed. This contract assigns the freelancer immediately.",
        complete:
          "Project marked as completed. The client can now release payment.",
        release:
          "Payment released successfully to the freelancer.",
        cancel:
          "Project cancelled. The net escrow amount was refunded; the platform fee is not refunded.",
      };

      setStatus({
        tone: "success",
        message: messages[action],
      });

      if (action === "create") {
        setDescription("");
      }

      await refresh();
    } catch (error: unknown) {
      setStatus({
        tone: "error",
        message: errorMessage(
          error,
          "Transaction failed."
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const account = address.toLowerCase();

  const myClientJobs = jobs.filter(
    (job) =>
      job.client.toLowerCase() === account &&
      account !== ""
  );

  const openJobs = jobs.filter(
    (job) =>
      !job.cancelled &&
      !job.paid &&
      job.freelancer.toLowerCase() ===
        ZERO_ADDRESS &&
      job.client.toLowerCase() !== account
  );

  const myFreelancerJobs = jobs.filter(
    (job) =>
      job.freelancer.toLowerCase() ===
        account &&
      account !== ""
  );

  const activeRoleCount =
    workspace === "client"
      ? myClientJobs.length
      : myFreelancerJobs.length;

  const clientMode = workspace === "client";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          type="button"
          className="brand"
          onClick={() => navigate("client")}
          aria-label="Worklane home"
        >
          <span className="brand__mark">
            <span />
          </span>
          <span>
            worklane
            <span className="brand__period">.</span>
          </span>
        </button>

        <div className="sidebar__group-label">
          YOUR WORKSPACES
        </div>

        <nav
          className="sidebar__nav"
          aria-label="Switch workspace"
        >
          <button
            type="button"
            className={`nav-link ${
              clientMode
                ? "nav-link--active"
                : ""
            }`}
            onClick={() => navigate("client")}
            aria-current={
              clientMode ? "page" : undefined
            }
          >
            <Icon name="briefcase" size={18} />
            Client workspace
            <span>01</span>
          </button>

          <button
            type="button"
            className={`nav-link ${
              !clientMode
                ? "nav-link--active"
                : ""
            }`}
            onClick={() => navigate("freelancer")}
            aria-current={
              !clientMode ? "page" : undefined
            }
          >
            <Icon name="layers" size={18} />
            Freelancer workspace
            <span>02</span>
          </button>
        </nav>

        <div className="sidebar__role-info">
          <Icon name="shield" size={19} />
          <p>
            One wallet, two ways to work.
            Your role depends on each project.
          </p>
        </div>

        <div className="sidebar__bottom">
          <div className="sidebar__art">
            <span>
              W
              <span className="sidebar__art-dot">
                .
              </span>
            </span>
            <div>
              Good work,
              <br />
              onchain.
            </div>
          </div>

          <div className="sidebar__environment">
            <span className="sidebar__environment-dot" />
            LOCAL DEVELOPMENT
            <span>v1.3</span>
          </div>
        </div>
      </aside>

      <main className="workspace" id="workroom">
        <header className="topbar">
          <div className="breadcrumbs">
            Worklane
            <span>/</span>
            <strong>
              {clientMode
                ? "Client workspace"
                : "Freelancer workspace"}
            </strong>
          </div>

          <div className="topbar__actions">
            <span
              className={`network-pill ${
                networkOnline === true
                  ? "network-pill--online"
                  : networkOnline === false
                    ? "network-pill--offline"
                    : ""
              }`}
            >
              <span className="state-dot" />
              {networkOnline === true
                ? "Hardhat connected"
                : networkOnline === false
                  ? "Network offline"
                  : "Connecting…"}
            </span>

            {signer && (
              <span
                className="topbar__wallet"
                title={address}
              >
                <Icon name="wallet" size={16} />
                {truncate(address, 7, 5)}
              </span>
            )}

            <button
              className="icon-button"
              type="button"
              onClick={() => void refresh()}
              disabled={busy || jobsLoading}
              title="Refresh jobs & balance"
              aria-label="Refresh jobs and balance"
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>
        </header>

        {!signer ? (
          <section
            className="welcome"
            aria-labelledby="welcome-title"
          >
            <div className="welcome__content">
              <span className="eyebrow eyebrow--muted">
                <span className="eyebrow__dash" />
                ONE WALLET. BOTH WORKSPACES.
              </span>

              <h1 id="welcome-title">
                Your work.
                <br />
                <em>On your terms.</em>
              </h1>

              <p>
                Connect your wallet once to
                publish projects as a client
                and take on projects as a
                freelancer. Your identity
                stays the same.
              </p>

              <button
                className="button button--primary welcome__connect"
                type="button"
                onClick={() => void connectMetaMask()}
                disabled={connecting || busy}
              >
                <Icon name="wallet" size={19} />
                {connecting
                  ? "Connecting MetaMask…"
                  : "Connect MetaMask"}
                <Icon name="arrow" size={18} />
              </button>

              <p className="welcome__hint">
                No private key is entered or
                stored in Worklane. MetaMask
                asks you to approve
                transactions individually.
              </p>

              <div
                className={`welcome__feedback activity-message activity-message--${status.tone}`}
                role="status"
              >
                <span className="activity-message__dot" />
                <p>{status.message}</p>
              </div>

              <a
                className="welcome__help"
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Don't have MetaMask?
                Get the official extension
                <Icon name="arrow" size={15} />
              </a>
            </div>

            <div
              className="welcome__visual"
              aria-hidden="true"
            >
              <div className="welcome__visual-header">
                <span>WORKLANE</span>
                <span>W / 003</span>
              </div>

              <div className="welcome__visual-center">
                <span className="welcome__visual-emblem">
                  ✳
                </span>
                <div>
                  One identity.
                  <br />
                  <em>Every possibility.</em>
                </div>
              </div>

              <div className="welcome__visual-roles">
                <span>01 / CLIENT</span>
                <span>02 / FREELANCER</span>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section
              className="hero"
              aria-labelledby="hero-title"
            >
              <div className="hero__content">
                <span className="eyebrow">
                  <span className="eyebrow__dash" />
                  {clientMode
                    ? "BUILD SOMETHING GREAT"
                    : "DO WHAT YOU DO BEST"}
                </span>

                <h1 id="hero-title">
                  {clientMode ? (
                    <>
                      Your idea.
                      <br />
                      <em>Real results.</em>
                    </>
                  ) : (
                    <>
                      Your craft.
                      <br />
                      <em>Your next job.</em>
                    </>
                  )}
                </h1>

                <p>
                  {clientMode
                    ? "Post a project, lock the budget in escrow, and release payment when the work is complete."
                    : "Discover open projects, take on work and get paid securely once your client approves the result."}
                </p>

                <button
                  className="hero__link"
                  type="button"
                  onClick={() =>
                    document
                      .getElementById("projects")
                      ?.scrollIntoView({
                        behavior: "smooth",
                      })
                  }
                >
                  Explore your workspace
                  <Icon name="arrow" size={17} />
                </button>
              </div>

              <div
                className="hero__graphic"
                aria-hidden="true"
              >
                <div className="hero__graphic-orbit hero__graphic-orbit--one" />
                <div className="hero__graphic-orbit hero__graphic-orbit--two" />
                <span className="hero__graphic-star">
                  ✳
                </span>
                <span className="hero__graphic-label">
                  WORK
                  <br />
                  WITHOUT
                  <br />
                  WORRY.
                </span>
                <span className="hero__graphic-bottom">
                  W / 002
                </span>
              </div>
            </section>

            <section
              className="metrics"
              aria-label="Workspace summary"
            >
              <div className="metric">
                <div className="metric__heading">
                  <span>YOUR ROLE</span>
                  <Icon
                    name={
                      clientMode
                        ? "briefcase"
                        : "layers"
                    }
                    size={17}
                  />
                </div>
                <strong className="metric__role">
                  {clientMode
                    ? "Client"
                    : "Freelancer"}
                </strong>
                <small>
                  Switch roles at any time
                </small>
              </div>

              <div className="metric">
                <div className="metric__heading">
                  <span>YOUR PROJECTS</span>
                  <Icon name="grid" size={17} />
                </div>
                <strong>{activeRoleCount}</strong>
                <small>
                  Among {jobCount} total jobs
                  on the local chain
                </small>
              </div>

              <div className="metric">
                <div className="metric__heading">
                  <span>WALLET BALANCE</span>
                  <Icon name="wallet" size={17} />
                </div>
                <strong className="metric__balance">
                  {balance
                    ? `${Number(balance).toFixed(3)} ETH`
                    : "—"}
                </strong>
                <small>
                  {address
                    ? truncate(address, 9, 6)
                    : "Connect your wallet"}
                </small>
              </div>
            </section>

            <div
              className="content-layout"
              id="projects"
            >
              <div className="content-layout__primary">
                {clientMode ? (
                  <>
                    <section
                      className="panel workflow-panel"
                      aria-labelledby="create-title"
                    >
                      <div className="panel__header">
                        <div>
                          <span className="eyebrow eyebrow--muted">
                            CLIENT WORKSPACE
                          </span>
                          <h2 id="create-title">
                            Start a project.
                          </h2>
                          <p>
                            Set the brief and
                            budget. Hardhat
                            escrow handles
                            the funds.
                          </p>
                        </div>
                        <span className="panel__index">
                          01 / CREATE
                        </span>
                      </div>

                      <div className="workflow-section workflow-section--first">
                        <div className="workflow-section__number">
                          01
                        </div>

                        <div className="workflow-section__body">
                          <div className="form-grid">
                            <div className="form-field form-field--wide">
                              <label htmlFor="job-description">
                                Project description
                              </label>
                              <input
                                id="job-description"
                                value={description}
                                onChange={(event) =>
                                  setDescription(
                                    event.target.value
                                  )
                                }
                                placeholder="e.g. Write product copy for an online store"
                              />
                            </div>

                            <div className="form-field">
                              <label htmlFor="job-budget">
                                Budget (ETH)
                              </label>
                              <div className="input-with-suffix">
                                <input
                                  id="job-budget"
                                  inputMode="decimal"
                                  value={budget}
                                  onChange={(event) =>
                                    setBudget(
                                      event.target.value
                                    )
                                  }
                                  placeholder="0.05"
                                />
                                <span>ETH</span>
                              </div>
                            </div>
                          </div>

                          <div className="escrow-note">
                            <Icon
                              name="shield"
                              size={18}
                            />
                            <span>
                              The marketplace
                              charges a 2% fee
                              on creation; the
                              rest goes into
                              escrow. If an
                              unassigned job
                              is cancelled,
                              only the escrowed
                              amount is refunded.
                            </span>
                          </div>

                          <button
                            className="button button--primary"
                            type="button"
                            onClick={() =>
                              void execute("create")
                            }
                            disabled={
                              busy ||
                              !signer ||
                              !networkOnline
                            }
                          >
                            Create & fund project
                            <Icon
                              name="arrow"
                              size={17}
                            />
                          </button>
                        </div>
                      </div>
                    </section>

                    <section
                      className="panel job-list-panel"
                      aria-labelledby="my-client-projects"
                    >
                      <div className="panel__header">
                        <div>
                          <span className="eyebrow eyebrow--muted">
                            YOUR CLIENT PROJECTS
                          </span>
                          <h2 id="my-client-projects">
                            Projects you've posted.
                          </h2>
                          <p>
                            Only projects created
                            by your connected wallet.
                          </p>
                        </div>
                        <span className="panel__index">
                          {myClientJobs.length} FOUND
                        </span>
                      </div>

                      <div className="job-list">
                        {myClientJobs.length === 0 ? (
                          <EmptyState
                            title="Nothing posted yet"
                            detail="Create your first project above."
                          />
                        ) : (
                          myClientJobs.map((job) => {
                            let action:
                              | {
                                  label: string;
                                  kind: Action;
                                }
                              | undefined;

                            if (
                              !job.cancelled &&
                              !job.paid
                            ) {
                              if (job.completed) {
                                action = {
                                  label:
                                    "Release payment",
                                  kind: "release",
                                };
                              } else if (
                                job.freelancer.toLowerCase() ===
                                ZERO_ADDRESS
                              ) {
                                action = {
                                  label:
                                    "Cancel & refund",
                                  kind: "cancel",
                                };
                              }
                            }

                            return (
                              <JobCard
                                key={job.id}
                                job={job}
                                action={action}
                                disabled={
                                  busy ||
                                  !networkOnline
                                }
                                onAction={(
                                  selectedAction,
                                  id
                                ) =>
                                  void execute(
                                    selectedAction,
                                    id
                                  )
                                }
                              />
                            );
                          })
                        )}
                      </div>
                    </section>
                  </>
                ) : (
                  <>
                    <section
                      className="panel job-list-panel"
                      aria-labelledby="open-jobs-title"
                    >
                      <div className="panel__header">
                        <div>
                          <span className="eyebrow eyebrow--muted">
                            FREELANCER WORKSPACE
                          </span>
                          <h2 id="open-jobs-title">
                            Explore open jobs.
                          </h2>
                          <p>
                            Projects waiting
                            for their first
                            freelancer.
                          </p>
                        </div>
                        <span className="panel__index">
                          {openJobs.length} OPEN
                        </span>
                      </div>

                      <div className="job-list">
                        {openJobs.length === 0 ? (
                          <EmptyState
                            title="No open projects"
                            detail="When someone posts a new project, it'll appear here."
                          />
                        ) : (
                          openJobs.map((job) => (
                            <JobCard
                              key={job.id}
                              job={job}
                              action={{
                                label:
                                  "Apply for job",
                                kind: "apply",
                              }}
                              disabled={
                                busy ||
                                !signer ||
                                !networkOnline
                              }
                              onAction={(
                                selectedAction,
                                id
                              ) =>
                                void execute(
                                  selectedAction,
                                  id
                                )
                              }
                            />
                          ))
                        )}
                      </div>
                    </section>

                    <section
                      className="panel job-list-panel"
                      aria-labelledby="my-freelance-projects"
                    >
                      <div className="panel__header">
                        <div>
                          <span className="eyebrow eyebrow--muted">
                            YOUR FREELANCE WORK
                          </span>
                          <h2 id="my-freelance-projects">
                            Your assignments.
                          </h2>
                          <p>
                            Jobs assigned to
                            the current wallet.
                          </p>
                        </div>
                        <span className="panel__index">
                          {myFreelancerJobs.length} FOUND
                        </span>
                      </div>

                      <div className="job-list">
                        {myFreelancerJobs.length === 0 ? (
                          <EmptyState
                            title="No assignments yet"
                            detail="Apply to an open job to get started."
                          />
                        ) : (
                          myFreelancerJobs.map(
                            (job) => (
                              <JobCard
                                key={job.id}
                                job={job}
                                action={
                                  !job.cancelled &&
                                  !job.completed &&
                                  !job.paid
                                    ? {
                                        label:
                                          "Mark completed",
                                        kind:
                                          "complete",
                                      }
                                    : undefined
                                }
                                disabled={
                                  busy ||
                                  !networkOnline
                                }
                                onAction={(
                                  selectedAction,
                                  id
                                ) =>
                                  void execute(
                                    selectedAction,
                                    id
                                  )
                                }
                              />
                            )
                          )
                        )}
                      </div>
                    </section>
                  </>
                )}

                <p className="list-disclaimer">
                  Showing the latest{" "}
                  {Math.min(
                    jobCount,
                    MAX_VISIBLE_JOBS
                  )}{" "}
                  jobs out of {jobCount} on
                  this local deployment.
                  The smart contract determines
                  permissions for every transaction.
                </p>
              </div>

              <div className="content-layout__secondary">
                <div className="section-intro">
                  <div>
                    <span className="eyebrow eyebrow--muted">
                      SHARED IDENTITY
                    </span>
                    <h2>Your wallet</h2>
                  </div>
                  <span>
                    ONE ADDRESS / BOTH ROLES
                  </span>
                </div>

                <section
                  className="wallet-card shared-wallet"
                  aria-label="Shared wallet"
                >
                  <div className="wallet-card__top">
                    <span className="wallet-card__number">
                      YOUR ONCHAIN IDENTITY
                    </span>
                    <span className="wallet-card__state is-connected">
                      <span className="state-dot" />
                      Connected
                    </span>
                  </div>

                  <div className="wallet-card__identity">
                    <span className="wallet-card__avatar">
                      W
                    </span>
                    <div>
                      <h3>Wallet ready</h3>
                      <p>
                        Use this address
                        in either workspace
                      </p>
                    </div>
                  </div>

                  <div className="wallet-card__balance">
                    <span>Available balance</span>
                    <strong>
                      {balance
                        ? Number(balance).toFixed(4)
                        : "—"}{" "}
                      <small>ETH</small>
                    </strong>
                  </div>

                  <div className="wallet-card__address">
                    <span>Address</span>
                    <code title={address}>
                      {truncate(address, 9, 7)}
                    </code>
                  </div>

                  <div className="wallet-mode">
                    Connected with MetaMask ·
                    Hardhat Local
                  </div>

                  <button
                    className="text-button"
                    type="button"
                    onClick={disconnectWallet}
                    disabled={busy}
                  >
                    <Icon
                      name="logout"
                      size={15}
                    />
                    Disconnect from Worklane
                  </button>
                </section>

                <div className="security-note">
                  <Icon
                    name="shield"
                    size={19}
                  />
                  <p>
                    <strong>
                      Local development only.
                    </strong>{" "}
                    Use only Hardhat test
                    accounts on chain {CHAIN_ID}.
                    Worklane never receives
                    your private key; MetaMask
                    signs each approved transaction.
                  </p>
                </div>

                <section
                  className="activity-card"
                  aria-live="polite"
                >
                  <div className="activity-card__header">
                    <span>ACTIVITY</span>
                    <span className="activity-card__pulse" />
                  </div>

                  <h3>Latest update</h3>

                  <div
                    className={`activity-message activity-message--${status.tone}`}
                  >
                    <span className="activity-message__dot" />
                    <p>{status.message}</p>
                  </div>

                  {lastTx && (
                    <div className="activity-card__transaction">
                      <span>
                        LAST TRANSACTION
                      </span>
                      <code title={lastTx}>
                        {truncate(
                          lastTx,
                          13,
                          9
                        )}
                      </code>
                    </div>
                  )}
                </section>
              </div>
            </div>
          </>
        )}

        <footer className="footer">
          <span>
            © 2026 Worklane ·
            Freelancer Marketplace
          </span>
          <span>
            LOCAL HARDHAT #{CHAIN_ID}
            <span className="footer__divider">
              /
            </span>
            <code>
              {truncate(
                MARKETPLACE_ADDRESS,
                9,
                7
              )}
            </code>
          </span>
        </footer>
      </main>
    </div>
  );
}
