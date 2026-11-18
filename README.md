# Freelancer Marketplace – Blockchain (Part 1)

Acest modul reprezinta partea de blockchain a proiectului **Freelancer Marketplace**.
Aplicatia implementeaza un marketplace descentralizat in care un client poate crea un job, un freelancer il poate prelua, iar plata este gestionata in siguranta printr-un mecanism de **escrow**.

Scopul principal al acestei parti este demonstrerea utilizarii smart-contractelor Solidity, a interactiunii intre contracte, a transferului de ETH si a testarii automate.

---

## 1. Arhitectura generala

Proiectul contine doua contracte principale:

### 1. FreelancerMarketplace.sol

Contractul principal care gestioneaza:

- crearea job-urilor
- asignarea freelancerilor
- marcarea job-urilor ca fiind finalizate
- eliberarea platilor
- anularea job-urilor

Acest contract contine logica de business si este singurul care poate interactiona cu escrow-ul.

### 2. Escrow.sol

Contract auxiliar care actioneaza ca un „vault” pentru fonduri:

- pastreaza fondurile blocate pentru fiecare job
- elibereaza fondurile catre freelancer
- returneaza fondurile catre client in caz de anulare

Escrow-ul este protejat printr-un modifier care permite apelarea functiilor sensibile **doar** de catre Marketplace.

---

## 2. Librarii utilizate

### 2.1 Librarie proprie (FeeMath)

Proiectul foloseste o librarie Solidity creata manual, `FeeMath`, care contine:

- calculul fee-ului platformei (in basis points)
- calculul sumei nete dupa fee
- validarea valorilor de fee

Aceasta librarie este folosita direct in contractul Marketplace si demonstreaza utilizarea conceptului de `library` in Solidity.

### 2.2 Librarie externa (OpenZeppelin)

Este folosita libraria **OpenZeppelin ReentrancyGuard** pentru a preveni atacuri de tip reentrancy in functiile care transfera ETH (`releasePayment`, `cancelJob`).

---

## 3. Fluxul logic al aplicatiei (Happy Path)

1. Clientul creeaza un job si trimite ETH:
   - se calculeaza fee-ul platformei
   - fee-ul este trimis catre `feeRecipient`
   - restul sumei este blocat in Escrow

2. Freelancerul aplica pentru job:
   - job-ul este asignat
   - nu mai poate aplica alt freelancer

3. Freelancerul marcheaza job-ul ca fiind finalizat

4. Clientul elibereaza plata:
   - Escrow transfera fondurile catre freelancer
   - fondurile pentru job sunt resetate la 0

---

## 4. Testare automata

Proiectul contine teste automate scrise cu **Hardhat + Mocha + Chai**.

Testele acopera:

- functii `pure` (calcul fee)
- fluxul complet de lucru (happy path)
- anularea job-urilor si refund
- restrictii de acces (modifiers)
- reguli de business (nu se poate elibera plata inainte de finalizare)

Testele ruleaza pe o retea Hardhat in-memory, complet izolata.

---

## 5. Local Development Setup

### Prerequisites

- Node.js 22.x
- npm
- Git

### Install and compile smart contracts

From the project root:

```powershell
cd blockchain
npm ci
npx hardhat compile
npx hardhat test
```

Compilation automatically generates the `typechain-types/` directory, which is required by the frontend.

### Start the local blockchain

In the first terminal, from `blockchain/`:

```powershell
npx hardhat node
```

The local Ethereum network runs at `http://127.0.0.1:8545` (Chain ID: 31337).

Keep this terminal running.

### Deploy smart contracts

In a second terminal, from `blockchain/`:

```powershell
npx hardhat run scripts/deploy.ts --network localhost
```

The deployment script creates `blockchain/deployments/localhost.json`, containing the local contract addresses used by the frontend.

### Start the frontend

In a third terminal, from `frontend/`:

```powershell
npm ci
npm run dev
```

Open `http://localhost:5173` in your browser.

### Important notes

- The application uses local Hardhat accounts with test ETH only.
- Never enter real wallet private keys into the demo interface.
- `typechain-types/` and `deployments/localhost.json` are generated locally and are not committed to Git.
- Restarting the Hardhat node resets the local blockchain. Redeploy the contracts before using the frontend again.
