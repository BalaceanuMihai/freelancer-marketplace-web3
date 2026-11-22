
import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const { ethers, networkName } = await network.create();

  // Acest script scrie deployments/localhost.json,
  // deci trebuie executat exclusiv pe reteaua localhost.
  if (networkName !== "localhost") {
    throw new Error(
      "Ruleaza scriptul cu --network localhost pentru a genera deployments/localhost.json"
    );
  }

  console.log("Network:", networkName);
  console.log("CWD:", process.cwd());

  // deployer -> deployeaza contractele
  // unused -> cont nefolosit
  // feeRecipient -> incaseaza comisionul platformei
  const [deployer, , feeRecipient] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Fee recipient:", feeRecipient.address);

  // 1. Deploy Escrow
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log("Escrow deployed to:", escrowAddress);

  // 2. Deploy FreelancerMarketplace
  const Marketplace = await ethers.getContractFactory(
    "FreelancerMarketplace"
  );

  const marketplace = await Marketplace.deploy(
    escrowAddress,
    feeRecipient.address
  );
  await marketplace.waitForDeployment();

  const marketplaceAddress = await marketplace.getAddress();
  console.log("Marketplace deployed to:", marketplaceAddress);

  // 3. Autorizam marketplace-ul in Escrow
  const tx = await escrow.setMarketplace(marketplaceAddress);
  await tx.wait();

  console.log("Escrow marketplace set.");

  // 4. Salvam adresele pentru frontend
  const net = await ethers.provider.getNetwork();

  const out = {
    chainId: Number(net.chainId),
    escrow: escrowAddress,
    marketplace: marketplaceAddress,
    feeRecipient: feeRecipient.address,
    deployer: deployer.address,
  };

  const outPath = path.resolve(
    process.cwd(),
    "deployments",
    "localhost.json"
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify(out, null, 2),
    "utf8"
  );

  console.log("Wrote deployments file to:", outPath);
  console.log("Deployments JSON:", out);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
