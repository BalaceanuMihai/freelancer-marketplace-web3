import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

type Deployments = {
  chainId: number;
  escrow: string;
  marketplace: string;
  feeRecipient: string;
  deployer: string;
};

function readDeployments(): Deployments {
  const p = path.resolve(process.cwd(), "deployments", "localhost.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `Nu gasesc ${p}. Ruleaza mai intai deploy:\n` +
        `npx hardhat run scripts/deploy.ts --network localhost`
    );
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function assert(condition: any, msg: string) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function expectRevert(promise: Promise<any>, contains?: string) {
  try {
    await promise;
    throw new Error("Expected revert, but transaction succeeded");
  } catch (e: any) {
    const m = String(e?.message ?? e);
    if (contains) {
      assert(
        m.includes(contains),
        `Revert message does not include "${contains}". Got: ${m}`
      );
    }
  }
}

function parseLogs(receipt: any, contracts: any[]) {
  const parsed: Array<{ name: string; args: any; address: string }> = [];
  for (const log of receipt.logs ?? []) {
    for (const c of contracts) {
      try {
        const p = c.interface.parseLog(log);
        parsed.push({ name: p.name, args: p.args, address: log.address });
        break;
      } catch {
        // ignore
      }
    }
  }
  return parsed;
}

async function main() {
  const dep = readDeployments();

  const [client, freelancer, other] = await ethers.getSigners();

  const marketplace = await ethers.getContractAt(
    "FreelancerMarketplace",
    dep.marketplace
  );
  const escrow = await ethers.getContractAt("Escrow", dep.escrow);

  console.log("== Addresses ==");
  console.log("Client:", client.address);
  console.log("Freelancer:", freelancer.address);
  console.log("Other:", other.address);
  console.log("Marketplace:", dep.marketplace);
  console.log("Escrow:", dep.escrow);
  console.log("FeeRecipient:", dep.feeRecipient);

  // -----------------------------
  // 0) Basic checks (state vars)
  // -----------------------------
  console.log("\n== 0) Basic checks ==");
  assert((await marketplace.escrow()) === dep.escrow, "marketplace.escrow mismatch");
  assert(
    (await marketplace.feeRecipient()) === dep.feeRecipient,
    "marketplace.feeRecipient mismatch"
  );

  // -----------------------------
  // 1) PURE function test
  // -----------------------------
  console.log("\n== 1) PURE: calculatePlatformFee ==");
  const oneEth = ethers.parseEther("1");
  const fee = await marketplace.calculatePlatformFee(oneEth);
  // 2% of 1 ETH = 0.02 ETH
  assert(fee === ethers.parseEther("0.02"), "fee should be 0.02 ETH");
  console.log("PASS: fee(1 ETH) =", ethers.formatEther(fee), "ETH");

  // helper for balance diffs
  const provider = client.provider!;
  const bal = async (addr: string) => provider.getBalance(addr);

  // -----------------------------
  // 2) HAPPY PATH: create -> apply -> complete -> release
  // -----------------------------
  console.log("\n== 2) HAPPY PATH ==");
  const feeRecipientBalBefore = await bal(dep.feeRecipient);
  const freelancerBalBefore = await bal(freelancer.address);

  const txCreate = await marketplace
    .connect(client)
    .createJob("SmokeTest job #1", { value: oneEth });
  const rcCreate = await txCreate.wait();

  const parsedCreate = parseLogs(rcCreate, [marketplace, escrow]);

  const evJobCreated = parsedCreate.find((x) => x.name === "JobCreated");
  assert(!!evJobCreated, "JobCreated event not found");
  const jobId1 = evJobCreated!.args.jobId as bigint;

  const evFeePaid = parsedCreate.find((x) => x.name === "PlatformFeePaid");
  assert(!!evFeePaid, "PlatformFeePaid event not found");

  const evDeposited = parsedCreate.find((x) => x.name === "Deposited");
  assert(!!evDeposited, "Escrow Deposited event not found");

  console.log("JobCreated jobId =", jobId1.toString());
  console.log("Events OK: JobCreated, PlatformFeePaid, Escrow.Deposited");

  const escrowLocked1 = await escrow.jobDeposits(jobId1);
  assert(escrowLocked1 === ethers.parseEther("0.98"), "escrow should lock 0.98 ETH");
  console.log("Escrow locked:", ethers.formatEther(escrowLocked1), "ETH");

  // VIEW function test
  const summary1 = await marketplace.getJobSummary(jobId1);
  assert(summary1.client === client.address, "getJobSummary client mismatch");
  assert(summary1.freelancer === ethers.ZeroAddress, "freelancer should be 0 before apply");
  assert(summary1.completed === false, "completed should be false initially");
  assert(summary1.totalAmount === ethers.parseEther("0.98"), "totalAmount should be net (0.98)");
  assert(summary1.escrowedAmount === ethers.parseEther("0.98"), "escrowedAmount should be 0.98");
  console.log("PASS: VIEW getJobSummary() initial");

  // apply
  const txApply = await marketplace.connect(freelancer).applyForJob(jobId1);
  const rcApply = await txApply.wait();
  const parsedApply = parseLogs(rcApply, [marketplace, escrow]);
  assert(parsedApply.some((x) => x.name === "FreelancerAssigned"), "FreelancerAssigned missing");
  console.log("PASS: applyForJob -> FreelancerAssigned");

  // markCompleted
  const txDone = await marketplace.connect(freelancer).markCompleted(jobId1);
  const rcDone = await txDone.wait();
  const parsedDone = parseLogs(rcDone, [marketplace, escrow]);
  assert(parsedDone.some((x) => x.name === "JobCompleted"), "JobCompleted missing");
  console.log("PASS: markCompleted -> JobCompleted");

  // releasePayment
  const txRelease = await marketplace.connect(client).releasePayment(jobId1);
  const rcRelease = await txRelease.wait();
  const parsedRelease = parseLogs(rcRelease, [marketplace, escrow]);
  assert(parsedRelease.some((x) => x.name === "PaymentReleased"), "PaymentReleased missing");
  assert(parsedRelease.some((x) => x.name === "Released"), "Escrow Released missing");
  console.log("PASS: releasePayment -> PaymentReleased + Escrow.Released");

  const escrowAfter1 = await escrow.jobDeposits(jobId1);
  assert(escrowAfter1 === 0n, "escrow should be 0 after release");

  const feeRecipientBalAfter = await bal(dep.feeRecipient);
  const freelancerBalAfter = await bal(freelancer.address);

  // feeRecipient should receive +0.02 ETH (minus 0 gas because receiver just gets ETH)
  assert(
    feeRecipientBalAfter - feeRecipientBalBefore === ethers.parseEther("0.02"),
    "feeRecipient should gain exactly 0.02 ETH"
  );

  // freelancer gains ~0.98 ETH (exact diff can be 0.98, freelancer also pays gas for apply+complete)
  // So we check it's at least +0.97 to be safe.
  const freelancerGain = freelancerBalAfter - freelancerBalBefore;
  assert(freelancerGain >= ethers.parseEther("0.97"), "freelancer should gain approx net funds");
  console.log(
    "PASS: balances (feeRecipient +0.02 ETH, freelancer +~0.98 ETH minus gas)"
  );

  // -----------------------------
  // 3) CANCEL / REFUND path: create -> cancelJob (no freelancer)
  // -----------------------------
  console.log("\n== 3) CANCEL / REFUND PATH ==");
  const clientBalBefore2 = await bal(client.address);

  const txCreate2 = await marketplace
    .connect(client)
    .createJob("SmokeTest job #2 (cancel)", { value: oneEth });
  const rcCreate2 = await txCreate2.wait();
  const parsedCreate2 = parseLogs(rcCreate2, [marketplace, escrow]);
  const evJobCreated2 = parsedCreate2.find((x) => x.name === "JobCreated");
  assert(!!evJobCreated2, "JobCreated #2 missing");
  const jobId2 = evJobCreated2!.args.jobId as bigint;

  assert((await escrow.jobDeposits(jobId2)) === ethers.parseEther("0.98"), "escrow #2 should lock 0.98");

  const txCancel = await marketplace.connect(client).cancelJob(jobId2);
  const rcCancel = await txCancel.wait();
  const parsedCancel = parseLogs(rcCancel, [marketplace, escrow]);
  assert(parsedCancel.some((x) => x.name === "JobCancelled"), "JobCancelled missing");
  assert(parsedCancel.some((x) => x.name === "Refunded"), "Escrow Refunded missing");

  assert((await escrow.jobDeposits(jobId2)) === 0n, "escrow #2 should be 0 after refund");

  const clientBalAfter2 = await bal(client.address);
  // client gets back net 0.98 ETH but paid gas for cancel/create, so check that balance increased vs
  // immediately after create is tricky; we just confirm escrow is zero + events ok.
  console.log("PASS: cancelJob -> JobCancelled + Escrow.Refunded, escrow is 0");

  // -----------------------------
  // 4) Negative tests (reverts) - modifiers & rules
  // -----------------------------
  console.log("\n== 4) NEGATIVE TESTS (reverts) ==");

  // 4.1 onlyMarketplace on Escrow
  await expectRevert(
    escrow.connect(client).deposit(999, { value: ethers.parseEther("0.1") }),
    "Only marketplace"
  );
  console.log("PASS: Escrow.deposit blocked by onlyMarketplace");

  // 4.2 createJob validations
  await expectRevert(
    marketplace.connect(client).createJob("", { value: oneEth }),
    "Description required"
  );
  await expectRevert(
    marketplace.connect(client).createJob("x", { value: 0 }),
    "Price must be > 0"
  );
  console.log("PASS: createJob input validation");

  // Create job #3 for rule tests
  const txCreate3 = await marketplace
    .connect(client)
    .createJob("SmokeTest job #3 (rules)", { value: oneEth });
  const rcCreate3 = await txCreate3.wait();
  const parsedCreate3 = parseLogs(rcCreate3, [marketplace, escrow]);
  const jobId3 = (parsedCreate3.find((x) => x.name === "JobCreated")!.args.jobId as bigint);

  // 4.3 onlyClient on cancel/release
  await expectRevert(marketplace.connect(other).cancelJob(jobId3), "Not client");
  await expectRevert(marketplace.connect(other).releasePayment(jobId3), "Not client");
  console.log("PASS: onlyClient enforced");

  // 4.4 applyForJob once
  await (await marketplace.connect(freelancer).applyForJob(jobId3)).wait();
  await expectRevert(marketplace.connect(other).applyForJob(jobId3), "Already assigned");
  console.log("PASS: cannot apply twice / after assigned");

  // 4.5 onlyFreelancer on markCompleted
  await expectRevert(marketplace.connect(other).markCompleted(jobId3), "Not freelancer");
  await (await marketplace.connect(freelancer).markCompleted(jobId3)).wait();
  console.log("PASS: onlyFreelancer enforced + completion works");

  // 4.6 cannot release before completion (we already completed, so create job #4)
  const txCreate4 = await marketplace
    .connect(client)
    .createJob("SmokeTest job #4 (release before done)", { value: oneEth });
  const rcCreate4 = await txCreate4.wait();
  const parsedCreate4 = parseLogs(rcCreate4, [marketplace, escrow]);
  const jobId4 = (parsedCreate4.find((x) => x.name === "JobCreated")!.args.jobId as bigint);

  await (await marketplace.connect(freelancer).applyForJob(jobId4)).wait();
  await expectRevert(marketplace.connect(client).releasePayment(jobId4), "Job not completed");
  console.log("PASS: cannot release before completed");

  // 4.7 cannot cancel after assigned
  await expectRevert(marketplace.connect(client).cancelJob(jobId4), "Job already assigned");
  console.log("PASS: cannot cancel after assigned");

  console.log("\n✅ ALL SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error("\n❌ SMOKE TEST FAILED\n", e);
  process.exitCode = 1;
});
