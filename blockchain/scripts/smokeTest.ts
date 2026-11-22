
import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const { ethers, networkName } = await network.create();

type Deployments = {
  chainId: number;
  escrow: string;
  marketplace: string;
  feeRecipient: string;
  deployer: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

function readDeployments(): Deployments {
  const filePath = path.resolve(
    process.cwd(),
    "deployments",
    "localhost.json"
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Nu gasesc ${filePath}.\n` +
        "Ruleaza mai intai:\n" +
        "npx hardhat run scripts/deploy.ts --network localhost"
    );
  }

  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  ) as Deployments;
}

async function expectRevert(
  promise: Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  try {
    const result = await promise;

    // Daca tranzactia a fost trimisa cu succes,
    // asteptam si executia ei.
    if (
      result !== null &&
      typeof result === "object" &&
      "wait" in result &&
      typeof result.wait === "function"
    ) {
      await result.wait();
    }
  } catch (error: unknown) {
    const actualMessage =
      error instanceof Error
        ? error.message
        : String(error);

    assert(
      actualMessage.includes(expectedMessage),
      `Revert message does not include "${expectedMessage}". ` +
        `Got: ${actualMessage}`
    );

    return;
  }

  throw new Error(
    `ASSERT FAILED: Expected revert containing "${expectedMessage}", ` +
      "but transaction succeeded"
  );
}

function parseLogs(receipt: any, contracts: any[]) {
  const parsed: Array<{
    name: string;
    args: any;
    address: string;
  }> = [];

  for (const log of receipt?.logs ?? []) {
    for (const contract of contracts) {
      try {
        const event = contract.interface.parseLog(log);

        if (event !== null) {
          parsed.push({
            name: event.name,
            args: event.args,
            address: log.address,
          });

          break;
        }
      } catch {
        // Logul poate apartine altui contract.
      }
    }
  }

  return parsed;
}

async function main() {
  // ------------------------------------------------
  // 0. Verificarea retelei si a deployment-ului
  // ------------------------------------------------

  if (networkName !== "localhost") {
    throw new Error(
      "Smoke test-ul trebuie rulat cu --network localhost"
    );
  }

  const dep = readDeployments();

  const actualChainId = Number(
    (await ethers.provider.getNetwork()).chainId
  );

  assert(
    actualChainId === dep.chainId,
    `Chain ID diferit: conectat la ${actualChainId}, ` +
      `deployment salvat pentru ${dep.chainId}`
  );

  assert(
    (await ethers.provider.getCode(dep.marketplace)) !== "0x",
    "Contractul Marketplace nu exista la adresa salvata"
  );

  assert(
    (await ethers.provider.getCode(dep.escrow)) !== "0x",
    "Contractul Escrow nu exista la adresa salvata"
  );

  const [client, freelancer, other] = await ethers.getSigners();

  const marketplace = await ethers.getContractAt(
    "FreelancerMarketplace",
    dep.marketplace
  );

  const escrow = await ethers.getContractAt(
    "Escrow",
    dep.escrow
  );

  console.log("== Network ==");
  console.log("Network:", networkName);
  console.log("Chain ID:", actualChainId);

  console.log("\n== Addresses ==");
  console.log("Client:", client.address);
  console.log("Freelancer:", freelancer.address);
  console.log("Other:", other.address);
  console.log("Marketplace:", dep.marketplace);
  console.log("Escrow:", dep.escrow);
  console.log("FeeRecipient:", dep.feeRecipient);
  console.log("Deployer:", dep.deployer);

  console.log("\n== 0) Basic checks ==");

  assert(
    (await marketplace.escrow()).toLowerCase() ===
      dep.escrow.toLowerCase(),
    "marketplace.escrow mismatch"
  );

  assert(
    (await marketplace.feeRecipient()).toLowerCase() ===
      dep.feeRecipient.toLowerCase(),
    "marketplace.feeRecipient mismatch"
  );

  console.log("PASS: network, contracts and state variables");

  // ------------------------------------------------
  // 1. PURE: calculatePlatformFee
  // ------------------------------------------------

  console.log("\n== 1) PURE: calculatePlatformFee ==");

  const oneEth = ethers.parseEther("1");

  const fee = await marketplace.calculatePlatformFee(oneEth);

  assert(
    fee === ethers.parseEther("0.02"),
    "fee should be 0.02 ETH"
  );

  console.log(
    "PASS: fee(1 ETH) =",
    ethers.formatEther(fee),
    "ETH"
  );

  // Helper pentru verificarea soldurilor.
  const provider = ethers.provider;

  const balanceOf = async (address: string) =>
    provider.getBalance(address);

  // ------------------------------------------------
  // 2. HAPPY PATH
  // create -> apply -> complete -> release
  // ------------------------------------------------

  console.log("\n== 2) HAPPY PATH ==");

  const feeRecipientBalBefore = await balanceOf(
    dep.feeRecipient
  );

  const freelancerBalBefore = await balanceOf(
    freelancer.address
  );

  // Create job.
  const txCreate = await marketplace
    .connect(client)
    .createJob("SmokeTest job #1", {
      value: oneEth,
    });

  const rcCreate = await txCreate.wait();

  const parsedCreate = parseLogs(
    rcCreate,
    [marketplace, escrow]
  );

  const evJobCreated = parsedCreate.find(
    (event) => event.name === "JobCreated"
  );

  assert(
    evJobCreated,
    "JobCreated event not found"
  );

  const jobId1 = evJobCreated.args.jobId as bigint;

  assert(
    parsedCreate.some(
      (event) => event.name === "PlatformFeePaid"
    ),
    "PlatformFeePaid event not found"
  );

  assert(
    parsedCreate.some(
      (event) => event.name === "Deposited"
    ),
    "Escrow Deposited event not found"
  );

  console.log("JobCreated jobId =", jobId1.toString());

  console.log(
    "PASS: JobCreated, PlatformFeePaid, Escrow.Deposited"
  );

  // Verificam suma blocata in Escrow.
  const escrowLocked1 = await escrow.jobDeposits(jobId1);

  assert(
    escrowLocked1 === ethers.parseEther("0.98"),
    "escrow should lock 0.98 ETH"
  );

  console.log(
    "Escrow locked:",
    ethers.formatEther(escrowLocked1),
    "ETH"
  );

  // Verificam datele jobului.
  const summary1 = await marketplace.getJobSummary(jobId1);

  assert(
    summary1.client.toLowerCase() ===
      client.address.toLowerCase(),
    "getJobSummary client mismatch"
  );

  assert(
    summary1.freelancer === ethers.ZeroAddress,
    "freelancer should be zero before apply"
  );

  assert(
    summary1.completed === false,
    "completed should be false initially"
  );

  assert(
    summary1.totalAmount === ethers.parseEther("0.98"),
    "totalAmount should be 0.98 ETH"
  );

  assert(
    summary1.escrowedAmount === ethers.parseEther("0.98"),
    "escrowedAmount should be 0.98 ETH"
  );

  console.log("PASS: VIEW getJobSummary() initial");

  // Freelancer applies.
  const txApply = await marketplace
    .connect(freelancer)
    .applyForJob(jobId1);

  const rcApply = await txApply.wait();

  const parsedApply = parseLogs(
    rcApply,
    [marketplace, escrow]
  );

  assert(
    parsedApply.some(
      (event) => event.name === "FreelancerAssigned"
    ),
    "FreelancerAssigned event missing"
  );

  console.log(
    "PASS: applyForJob -> FreelancerAssigned"
  );

  // Freelancer marks the job as completed.
  const txDone = await marketplace
    .connect(freelancer)
    .markCompleted(jobId1);

  const rcDone = await txDone.wait();

  const parsedDone = parseLogs(
    rcDone,
    [marketplace, escrow]
  );

  assert(
    parsedDone.some(
      (event) => event.name === "JobCompleted"
    ),
    "JobCompleted event missing"
  );

  console.log(
    "PASS: markCompleted -> JobCompleted"
  );

  // Client releases payment.
  const txRelease = await marketplace
    .connect(client)
    .releasePayment(jobId1);

  const rcRelease = await txRelease.wait();

  const parsedRelease = parseLogs(
    rcRelease,
    [marketplace, escrow]
  );

  assert(
    parsedRelease.some(
      (event) => event.name === "PaymentReleased"
    ),
    "PaymentReleased event missing"
  );

  assert(
    parsedRelease.some(
      (event) => event.name === "Released"
    ),
    "Escrow Released event missing"
  );

  console.log(
    "PASS: releasePayment -> PaymentReleased + Escrow.Released"
  );

  // Escrow-ul trebuie sa fie gol.
  const escrowAfter1 = await escrow.jobDeposits(jobId1);

  assert(
    escrowAfter1 === 0n,
    "escrow should be zero after release"
  );

  // Verificam distribuirea fondurilor.
  const feeRecipientBalAfter = await balanceOf(
    dep.feeRecipient
  );

  const freelancerBalAfter = await balanceOf(
    freelancer.address
  );

  assert(
    feeRecipientBalAfter - feeRecipientBalBefore ===
      ethers.parseEther("0.02"),
    "feeRecipient should gain exactly 0.02 ETH"
  );

  const freelancerGain =
    freelancerBalAfter - freelancerBalBefore;

  assert(
    freelancerGain >= ethers.parseEther("0.97"),
    "freelancer should gain approximately 0.98 ETH minus gas"
  );

  console.log(
    "PASS: balances (feeRecipient +0.02 ETH, " +
      "freelancer +~0.98 ETH minus gas)"
  );

  // ------------------------------------------------
  // 3. CANCEL / REFUND PATH
  // ------------------------------------------------

  console.log("\n== 3) CANCEL / REFUND PATH ==");

  const txCreate2 = await marketplace
    .connect(client)
    .createJob("SmokeTest job #2 (cancel)", {
      value: oneEth,
    });

  const rcCreate2 = await txCreate2.wait();

  const parsedCreate2 = parseLogs(
    rcCreate2,
    [marketplace, escrow]
  );

  const evJobCreated2 = parsedCreate2.find(
    (event) => event.name === "JobCreated"
  );

  assert(
    evJobCreated2,
    "JobCreated #2 missing"
  );

  const jobId2 = evJobCreated2.args.jobId as bigint;

  assert(
    (await escrow.jobDeposits(jobId2)) ===
      ethers.parseEther("0.98"),
    "escrow #2 should lock 0.98 ETH"
  );

  const txCancel = await marketplace
    .connect(client)
    .cancelJob(jobId2);

  const rcCancel = await txCancel.wait();

  const parsedCancel = parseLogs(
    rcCancel,
    [marketplace, escrow]
  );

  assert(
    parsedCancel.some(
      (event) => event.name === "JobCancelled"
    ),
    "JobCancelled event missing"
  );

  assert(
    parsedCancel.some(
      (event) => event.name === "Refunded"
    ),
    "Escrow Refunded event missing"
  );

  assert(
    (await escrow.jobDeposits(jobId2)) === 0n,
    "escrow #2 should be zero after refund"
  );

  console.log(
    "PASS: cancelJob -> JobCancelled + Escrow.Refunded"
  );

  // ------------------------------------------------
  // 4. NEGATIVE TESTS
  // ------------------------------------------------

  console.log("\n== 4) NEGATIVE TESTS (reverts) ==");

  // 4.1 Escrow: onlyMarketplace.
  await expectRevert(
    escrow
      .connect(client)
      .deposit(999, {
        value: ethers.parseEther("0.1"),
      }),
    "Only marketplace"
  );

  console.log(
    "PASS: Escrow.deposit blocked by onlyMarketplace"
  );

  // 4.2 createJob validation.
  await expectRevert(
    marketplace
      .connect(client)
      .createJob("", {
        value: oneEth,
      }),
    "Description required"
  );

  await expectRevert(
    marketplace
      .connect(client)
      .createJob("x", {
        value: 0,
      }),
    "Price must be > 0"
  );

  console.log(
    "PASS: createJob input validation"
  );

  // Cream job #3 pentru verificarile de autorizare.
  const txCreate3 = await marketplace
    .connect(client)
    .createJob("SmokeTest job #3 (rules)", {
      value: oneEth,
    });

  const rcCreate3 = await txCreate3.wait();

  const parsedCreate3 = parseLogs(
    rcCreate3,
    [marketplace, escrow]
  );

  const evJobCreated3 = parsedCreate3.find(
    (event) => event.name === "JobCreated"
  );

  assert(
    evJobCreated3,
    "JobCreated #3 missing"
  );

  const jobId3 = evJobCreated3.args.jobId as bigint;

  // 4.3 onlyClient.
  await expectRevert(
    marketplace
      .connect(other)
      .cancelJob(jobId3),
    "Not client"
  );

  await expectRevert(
    marketplace
      .connect(other)
      .releasePayment(jobId3),
    "Not client"
  );

  console.log("PASS: onlyClient enforced");

  // 4.4 Freelancer can only be assigned once.
  await (
    await marketplace
      .connect(freelancer)
      .applyForJob(jobId3)
  ).wait();

  await expectRevert(
    marketplace
      .connect(other)
      .applyForJob(jobId3),
    "Already assigned"
  );

  console.log(
    "PASS: cannot apply twice / after assigned"
  );

  // 4.5 onlyFreelancer.
  await expectRevert(
    marketplace
      .connect(other)
      .markCompleted(jobId3),
    "Not freelancer"
  );

  await (
    await marketplace
      .connect(freelancer)
      .markCompleted(jobId3)
  ).wait();

  console.log(
    "PASS: onlyFreelancer enforced + completion works"
  );

  // 4.6 Cannot release before completion.
  const txCreate4 = await marketplace
    .connect(client)
    .createJob(
      "SmokeTest job #4 (release before done)",
      { value: oneEth }
    );

  const rcCreate4 = await txCreate4.wait();

  const parsedCreate4 = parseLogs(
    rcCreate4,
    [marketplace, escrow]
  );

  const evJobCreated4 = parsedCreate4.find(
    (event) => event.name === "JobCreated"
  );

  assert(
    evJobCreated4,
    "JobCreated #4 missing"
  );

  const jobId4 = evJobCreated4.args.jobId as bigint;

  await (
    await marketplace
      .connect(freelancer)
      .applyForJob(jobId4)
  ).wait();

  await expectRevert(
    marketplace
      .connect(client)
      .releasePayment(jobId4),
    "Job not completed"
  );

  console.log(
    "PASS: cannot release before completed"
  );

  // 4.7 Cannot cancel an assigned job.
  await expectRevert(
    marketplace
      .connect(client)
      .cancelJob(jobId4),
    "Job already assigned"
  );

  console.log(
    "PASS: cannot cancel after assigned"
  );

  console.log("\nALL SMOKE TESTS PASSED");
}

main().catch((error) => {
  console.error("SMOKE TEST FAILED:", error);
  process.exitCode = 1;
});
