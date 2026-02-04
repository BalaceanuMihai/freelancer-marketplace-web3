import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  console.log("CWD:", process.cwd());
  console.log("__dirname:", __dirname);

  // Luam 3 conturi:
  // deployer      -> deployeaza contractele
  // unused        -> nu il folosim
  // feeRecipient  -> incaseaza comisionul platformei
  const [deployer, , feeRecipient] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Fee recipient:", feeRecipient.address);

  // 1) Deploy Escrow
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  console.log("Escrow deployed to:", escrowAddress);

  // 2) Deploy Marketplace cu feeRecipient separat
  const Marketplace = await ethers.getContractFactory("FreelancerMarketplace");
  const marketplace = await Marketplace.deploy(
    escrowAddress,
    feeRecipient.address
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();

  console.log("Marketplace deployed to:", marketplaceAddress);

  // 3) Seteaza marketplace in escrow (pentru onlyMarketplace)
  const tx = await escrow.setMarketplace(marketplaceAddress);
  await tx.wait();
  console.log("Escrow marketplace set.");

  // 4) Scrie deployments/localhost.json
  const net = await ethers.provider.getNetwork();
  const out = {
    chainId: Number(net.chainId),
    escrow: escrowAddress,
    marketplace: marketplaceAddress,
    feeRecipient: feeRecipient.address,
    deployer: deployer.address,
  };

  const outPath = path.resolve(process.cwd(), "deployments", "localhost.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

  console.log("Wrote deployments file to:", outPath);
  console.log("Deployments JSON:", out);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
