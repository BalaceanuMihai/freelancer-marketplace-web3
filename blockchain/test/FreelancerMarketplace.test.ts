import { expect } from "chai";
import { ethers } from "hardhat";

describe("FreelancerMarketplace", function () {
  async function deployFixture() {
    const [deployer, client, freelancer, other] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("FreelancerMarketplace");
    const marketplace = await Marketplace.deploy(
      await escrow.getAddress(),
      deployer.address
    );
    await marketplace.waitForDeployment();

    await escrow.setMarketplace(await marketplace.getAddress());

    return { marketplace, escrow, deployer, client, freelancer, other };
  }

  it("calculatePlatformFee (pure)", async function () {
    const { marketplace } = await deployFixture();

    const fee = await marketplace.calculatePlatformFee(
      ethers.parseEther("1")
    );

    expect(fee).to.equal(ethers.parseEther("0.02")); // 2%
  });

  it("happy path: create -> apply -> complete -> release", async function () {
    const { marketplace, escrow, client, freelancer, deployer } =
      await deployFixture();

    const tx = await marketplace
      .connect(client)
      .createJob("Test job", {
        value: ethers.parseEther("1"),
      });

    const receipt = await tx.wait();
    const jobId = receipt!.logs
      .map((l) => {
        try {
          return marketplace.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x) => x?.name === "JobCreated")!.args.jobId;

    await marketplace.connect(freelancer).applyForJob(jobId);
    await marketplace.connect(freelancer).markCompleted(jobId);

    const balBefore = await ethers.provider.getBalance(freelancer.address);

    await marketplace.connect(client).releasePayment(jobId);

    const balAfter = await ethers.provider.getBalance(freelancer.address);

    expect(await escrow.jobDeposits(jobId)).to.equal(0);
    expect(balAfter).to.be.gt(balBefore);
  });

  it("cancel job refunds escrow", async function () {
    const { marketplace, escrow, client } = await deployFixture();

    const tx = await marketplace
      .connect(client)
      .createJob("Cancelable job", {
        value: ethers.parseEther("1"),
      });

    const receipt = await tx.wait();
    const jobId = receipt!.logs
      .map((l) => {
        try {
          return marketplace.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x) => x?.name === "JobCreated")!.args.jobId;

    await marketplace.connect(client).cancelJob(jobId);

    expect(await escrow.jobDeposits(jobId)).to.equal(0);
  });

  it("Escrow: only marketplace can deposit", async function () {
    const { escrow, client } = await deployFixture();

    await expect(
      escrow.connect(client).deposit(1, { value: 100 })
    ).to.be.revertedWith("Only marketplace");
  });

  it("cannot release payment before completion", async function () {
    const { marketplace, client, freelancer } = await deployFixture();

    const tx = await marketplace
      .connect(client)
      .createJob("Incomplete job", {
        value: ethers.parseEther("1"),
      });

    const receipt = await tx.wait();
    const jobId = receipt!.logs
      .map((l) => {
        try {
          return marketplace.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((x) => x?.name === "JobCreated")!.args.jobId;

    await marketplace.connect(freelancer).applyForJob(jobId);

    await expect(
      marketplace.connect(client).releasePayment(jobId)
    ).to.be.revertedWith("Job not completed");
  });
});
