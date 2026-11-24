
import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("FreelancerMarketplace", function () {
  async function deployFixture() {
    const [deployer, client, freelancer, other] =
      await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    const Marketplace = await ethers.getContractFactory(
      "FreelancerMarketplace"
    );

    const marketplace = await Marketplace.deploy(
      await escrow.getAddress(),
      deployer.address
    );
    await marketplace.waitForDeployment();

    const tx = await escrow.setMarketplace(
      await marketplace.getAddress()
    );
    await tx.wait();

    async function createJob(
      description = "Test job",
      value = ethers.parseEther("1")
    ) {
      const jobId = await marketplace.nextJobId();

      const createTx = await marketplace
        .connect(client)
        .createJob(description, { value });

      await createTx.wait();

      return jobId;
    }

    return {
      marketplace,
      escrow,
      deployer,
      client,
      freelancer,
      other,
      createJob,
    };
  }

  describe("Platform fee", function () {
    it("calculates the 2% platform fee", async function () {
      const { marketplace } =
        await networkHelpers.loadFixture(deployFixture);

      const fee = await marketplace.calculatePlatformFee(
        ethers.parseEther("1")
      );

      expect(fee).to.equal(ethers.parseEther("0.02"));
    });
  });

  describe("Complete job lifecycle", function () {
    it("creates, assigns, completes and pays a job", async function () {
      const {
        marketplace,
        escrow,
        deployer,
        client,
        freelancer,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const netAmount = ethers.parseEther("0.98");
      const platformFee = ethers.parseEther("0.02");

      const feeBalanceBefore =
        await ethers.provider.getBalance(deployer.address);

      const jobId = await createJob();

      const feeBalanceAfter =
        await ethers.provider.getBalance(deployer.address);

      expect(feeBalanceAfter - feeBalanceBefore).to.equal(
        platformFee
      );

      expect(await escrow.jobDeposits(jobId)).to.equal(
        netAmount
      );

      const createdJob = await marketplace.jobs(jobId);

      expect(createdJob.client).to.equal(client.address);
      expect(createdJob.freelancer).to.equal(
        ethers.ZeroAddress
      );
      expect(createdJob.completed).to.equal(false);
      expect(createdJob.paid).to.equal(false);
      expect(createdJob.cancelled).to.equal(false);

      const applyTx = await marketplace
        .connect(freelancer)
        .applyForJob(jobId);
      await applyTx.wait();

      const assignedJob = await marketplace.jobs(jobId);

      expect(assignedJob.freelancer).to.equal(
        freelancer.address
      );

      const completeTx = await marketplace
        .connect(freelancer)
        .markCompleted(jobId);
      await completeTx.wait();

      const completedJob = await marketplace.jobs(jobId);

      expect(completedJob.completed).to.equal(true);
      expect(completedJob.paid).to.equal(false);

      const balanceBefore =
        await ethers.provider.getBalance(
          freelancer.address
        );

      const releaseTx = await marketplace
        .connect(client)
        .releasePayment(jobId);
      await releaseTx.wait();

      const balanceAfter =
        await ethers.provider.getBalance(
          freelancer.address
        );

      expect(balanceAfter - balanceBefore).to.equal(
        netAmount
      );

      expect(await escrow.jobDeposits(jobId)).to.equal(0n);

      const paidJob = await marketplace.jobs(jobId);

      expect(paidJob.completed).to.equal(true);
      expect(paidJob.paid).to.equal(true);
      expect(paidJob.cancelled).to.equal(false);
    });
  });

  describe("Job cancellation", function () {
    it("allows the client to cancel an unassigned job", async function () {
      const {
        marketplace,
        escrow,
        client,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob("Cancelable job");

      expect(await escrow.jobDeposits(jobId)).to.equal(
        ethers.parseEther("0.98")
      );

      const cancelTx = await marketplace
        .connect(client)
        .cancelJob(jobId);
      await cancelTx.wait();

      const job = await marketplace.jobs(jobId);

      expect(job.cancelled).to.equal(true);
      expect(job.completed).to.equal(false);
      expect(job.paid).to.equal(false);
      expect(await escrow.jobDeposits(jobId)).to.equal(0n);
    });

    it("rejects applications to cancelled jobs", async function () {
      const {
        marketplace,
        client,
        freelancer,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob("Cancelled job");

      await marketplace.connect(client).cancelJob(jobId);

      await expect(
        marketplace.connect(freelancer).applyForJob(jobId)
      ).to.be.revertedWith("Job cancelled");
    });

    it("prevents cancelling the same job twice", async function () {
      const {
        marketplace,
        client,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace.connect(client).cancelJob(jobId);

      await expect(
        marketplace.connect(client).cancelJob(jobId)
      ).to.be.revertedWith("Already cancelled");
    });

    it("prevents another user from cancelling a job", async function () {
      const {
        marketplace,
        other,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await expect(
        marketplace.connect(other).cancelJob(jobId)
      ).to.be.revertedWith("Not client");
    });

    it("prevents cancelling an assigned job", async function () {
      const {
        marketplace,
        client,
        freelancer,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await expect(
        marketplace.connect(client).cancelJob(jobId)
      ).to.be.revertedWith("Job already assigned");
    });
  });

  describe("Job applications", function () {
    it("prevents a client from applying to their own job", async function () {
      const {
        marketplace,
        client,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await expect(
        marketplace.connect(client).applyForJob(jobId)
      ).to.be.revertedWith(
        "Client cannot apply to own job"
      );
    });

    it("prevents assigning a job twice", async function () {
      const {
        marketplace,
        freelancer,
        other,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await expect(
        marketplace.connect(other).applyForJob(jobId)
      ).to.be.revertedWith("Already assigned");
    });

    it("rejects applications to nonexistent jobs", async function () {
      const {
        marketplace,
        freelancer,
      } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        marketplace.connect(freelancer).applyForJob(999n)
      ).to.be.revertedWith("Job does not exist");
    });
  });

  describe("Access control", function () {
    it("allows only the assigned freelancer to complete a job", async function () {
      const {
        marketplace,
        client,
        freelancer,
        other,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await expect(
        marketplace.connect(client).markCompleted(jobId)
      ).to.be.revertedWith("Not freelancer");

      await expect(
        marketplace.connect(other).markCompleted(jobId)
      ).to.be.revertedWith("Not freelancer");
    });

    it("allows only the client to release payment", async function () {
      const {
        marketplace,
        freelancer,
        other,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await marketplace
        .connect(freelancer)
        .markCompleted(jobId);

      await expect(
        marketplace.connect(freelancer).releasePayment(jobId)
      ).to.be.revertedWith("Not client");

      await expect(
        marketplace.connect(other).releasePayment(jobId)
      ).to.be.revertedWith("Not client");
    });

    it("allows only the marketplace to deposit into escrow", async function () {
      const {
        escrow,
        client,
      } = await networkHelpers.loadFixture(deployFixture);

      await expect(
        escrow.connect(client).deposit(1, { value: 100 })
      ).to.be.revertedWith("Only marketplace");
    });
  });

  describe("Payment protection", function () {
    it("prevents payment before job completion", async function () {
      const {
        marketplace,
        client,
        freelancer,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob("Incomplete job");

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await expect(
        marketplace.connect(client).releasePayment(jobId)
      ).to.be.revertedWith("Job not completed");
    });

    it("prevents double payment", async function () {
      const {
        marketplace,
        client,
        freelancer,
        createJob,
      } = await networkHelpers.loadFixture(deployFixture);

      const jobId = await createJob();

      await marketplace
        .connect(freelancer)
        .applyForJob(jobId);

      await marketplace
        .connect(freelancer)
        .markCompleted(jobId);

      await marketplace
        .connect(client)
        .releasePayment(jobId);

      await expect(
        marketplace.connect(client).releasePayment(jobId)
      ).to.be.revertedWith("Already paid");
    });
  });
});
