import { ethers } from "hardhat";

async function main() {
  const [client, freelancer] = await ethers.getSigners();

  const marketplaceAddress = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
  const escrowAddress = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

  const marketplace = await ethers.getContractAt("FreelancerMarketplace", marketplaceAddress);
  const escrow = await ethers.getContractAt("Escrow", escrowAddress);

  console.log("Client:", client.address);
  console.log("Freelancer:", freelancer.address);

  const balClientBefore = await client.provider.getBalance(client.address);
  const balFreelancerBefore = await freelancer.provider.getBalance(freelancer.address);

  // 1) client creates job with 1 ETH
  const tx1 = await marketplace.connect(client).createJob("Test job", {
    value: ethers.parseEther("1.0"),
  });
  await tx1.wait();

  const jobId = 0;

  const locked = await escrow.jobDeposits(jobId);
  console.log("Escrow locked for jobId 0:", ethers.formatEther(locked), "ETH");

  // 2) freelancer applies + completes
  await (await marketplace.connect(freelancer).applyForJob(jobId)).wait();
  await (await marketplace.connect(freelancer).markCompleted(jobId)).wait();

  // 3) client releases payment
  await (await marketplace.connect(client).releasePayment(jobId)).wait();

  const lockedAfter = await escrow.jobDeposits(jobId);
  console.log("Escrow locked after release:", ethers.formatEther(lockedAfter), "ETH");

  const balClientAfter = await client.provider.getBalance(client.address);
  const balFreelancerAfter = await freelancer.provider.getBalance(freelancer.address);

  console.log("Client balance diff:", ethers.formatEther(balClientAfter - balClientBefore), "ETH");
  console.log("Freelancer balance diff:", ethers.formatEther(balFreelancerAfter - balFreelancerBefore), "ETH");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
