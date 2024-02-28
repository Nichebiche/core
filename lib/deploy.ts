import { BaseContract, ContractDeployTransaction, ContractFactory, ContractTransactionReceipt } from "ethers";
import { artifacts, ethers } from "hardhat";

import { log, yl } from "lib/log";
import { updateObjectInState } from "lib/state-file";

// TODO: check and remove type 1 support
const GAS_PRICE = process.env.GAS_PRICE || null;
const GAS_PRIORITY_FEE = process.env.GAS_PRIORITY_FEE || null;
const GAS_MAX_FEE = process.env.GAS_MAX_FEE || null;

const PROXY_CONTRACT_NAME = "OssifiableProxy";

type TxParams = {
  from: string;
  value?: bigint | string;
};

interface ContractHelper {
  name: string;
  contractPath: string;
  deploymentTx?: ContractDeployTransaction | unknown;
  address: string;
}

export type Contract = BaseContract & ContractHelper;

export async function getContractAt(name: string, address: string): Promise<Contract> {
  const contract = (await ethers.getContractAt(name, address)) as unknown as Contract;
  const artifact = await artifacts.readArtifact(name);
  // TODO: use updateWithNameAndPath
  contract.name = name;
  contract.contractPath = artifact.sourceName;
  contract.address = await contract.getAddress();
  return contract as unknown as Contract;
}

class TotalGasCounterPrivate {
  totalGasUsed: bigint;

  constructor() {
    this.totalGasUsed = 0n;
  }
}

export class TotalGasCounter {
  static instance: TotalGasCounterPrivate;

  constructor() {
    throw new Error("Use TotalGasCounter.getInstance()");
  }

  static getInstance(): TotalGasCounterPrivate {
    if (!TotalGasCounter.instance) {
      TotalGasCounter.instance = new TotalGasCounterPrivate();
    }
    return TotalGasCounter.instance;
  }

  static add(gasUsed: number | bigint) {
    return (this.getInstance().totalGasUsed += BigInt(gasUsed));
  }

  static getTotalGasUsed(): bigint {
    return this.getInstance().totalGasUsed;
  }

  // TODO: rename and maybe remove
  static async incrementTotalGasUsedInStateFile() {}
}

async function getDeploymentGasUsed(contract: Contract) {
  contract;
  return 0;
}

export async function makeTx(
  contract: Contract,
  funcName: string,
  args: unknown[],
  txParams: TxParams,
): Promise<ContractTransactionReceipt> {
  log.lineWithArguments(`${yl(contract.name)}[${contract.address}].${yl(funcName)}`, args);

  const tx = await contract.getFunction(funcName)(...args, txParams);
  log(`tx sent: ${tx.hash} (nonce ${tx.nonce})...`);

  const receipt = await tx.wait();
  const gasUsed = receipt.gasUsed;
  log(`tx executed: gasUsed ${gasUsed}`);
  log.emptyLine();

  TotalGasCounter.add(gasUsed);
  return receipt;
}

// TODO
// async function updateWithNameAndPath(contract: Contract, name: string) {
//   const artifact = await artifacts.readArtifact(name);
//   contract.name = name;
//   contract.contractPath = artifact.sourceName;
//   contract.address = await contract.getAddress();
// }

export async function getContractPath(contractName: string) {
  const artifact = await artifacts.readArtifact(contractName);
  return artifact.sourceName;
  // TODO
  // return await artifacts.require(contractName)._hArtifact.sourceName
}

// TODO: assertProxiedContractBytecode
// TODO: assertDeployedBytecode

async function getDeployTxParams(deployer: string) {
  const deployerSigner = await ethers.provider.getSigner();
  if (deployer !== deployerSigner.address) {
    throw new Error("DEPLOYER set in ENV must correspond to the first signer of hardhat");
  }

  if (GAS_PRIORITY_FEE !== null && GAS_MAX_FEE !== null) {
    return {
      type: 2,
      maxPriorityFeePerGas: ethers.parseUnits(String(GAS_PRIORITY_FEE), "gwei"),
      maxFeePerGas: ethers.parseUnits(String(GAS_MAX_FEE), "gwei"),
    };
  } else if (GAS_PRICE !== null) {
    return {
      from: deployer,
      gasPrice: GAS_PRICE,
    };
  } else {
    throw new Error(
      'Must specify gas ENV vars: either "GAS_PRICE" or both "GAS_PRIORITY_FEE" and "GAS_MAX_FEE" in gwei (like just "3")',
    );
  }
}

async function deployContractType2(
  artifactName: string,
  constructorArgs: unknown[],
  deployer: string,
): Promise<Contract> {
  const txParams = await getDeployTxParams(deployer);
  const factory: ContractFactory = await ethers.getContractFactory(artifactName);
  const contract: Contract = (await factory.deploy(...constructorArgs, txParams)) as Contract;
  const tx = contract.deploymentTransaction();
  if (tx) {
    log(`sent deployment tx ${tx.hash} (nonce ${tx.nonce})...`);
    await contract.waitForDeployment();
    const artifact = await artifacts.readArtifact(artifactName);
    contract.name = artifactName;
    contract.contractPath = artifact.sourceName;
    contract.address = contract.target as string;
    contract.deploymentTx = tx.hash;
  } else {
    throw new Error(`Failed to send the deployment transaction for ${artifactName}`);
  }

  return contract;
}

export async function deployContract(
  artifactName: string,
  constructorArgs: unknown[],
  deployer: string,
): Promise<Contract> {
  const txParams = await getDeployTxParams(deployer);
  if (txParams.type === 2) {
    return await deployContractType2(artifactName, constructorArgs, deployer);
  } else {
    // TODO: maybe restore
    throw Error("Tx type 1 is not supported");
  }
}

export async function deployWithoutProxy(
  nameInState: string,
  artifactName: string,
  deployer: string,
  constructorArgs: unknown[] = [],
  addressFieldName = "address",
): Promise<Contract> {
  // TODO: maybe don't deploy if already deployed / specified

  log.lineWithArguments(`Deploying ${artifactName} (without proxy) with constructor args: `, constructorArgs);

  const contract = await deployContract(artifactName, constructorArgs, deployer);

  const gasUsed = await getDeploymentGasUsed(contract);
  log(`deployed at ${contract.address} (gas used ${gasUsed})`);
  log.emptyLine();
  TotalGasCounter.add(gasUsed);

  updateObjectInState(nameInState, {
    contract: await getContractPath(artifactName),
    [addressFieldName]: contract.address,
    constructorArgs: constructorArgs,
  });

  return contract;
}

export async function deployImplementation(
  nameInState: string,
  artifactName: string,
  deployer: string,
  constructorArgs: unknown[] = [],
): Promise<Contract> {
  log.lineWithArguments(
    `Deploying implementation for proxy of ${artifactName} with constructor args: `,
    constructorArgs,
  );
  const contract = await deployContract(artifactName, constructorArgs, deployer);
  const gasUsed = await getDeploymentGasUsed(contract);
  TotalGasCounter.add(gasUsed);
  log(`deployed at ${contract.address} (gas used ${gasUsed})`);
  log.emptyLine();

  updateObjectInState(nameInState, {
    implementation: {
      contract: contract.contractPath,
      address: contract.address,
      constructorArgs: constructorArgs,
    },
  });
  return contract;
}

export async function deployBehindOssifiableProxy(
  nameInState: string | null,
  artifactName: string,
  proxyOwner: string,
  deployer: string,
  constructorArgs: unknown[] = [],
  implementation: null | string = null,
) {
  if (implementation === null) {
    log.lineWithArguments(
      `Deploying implementation for proxy of ${artifactName} with constructor args: `,
      constructorArgs,
    );
    const contract = await deployContract(artifactName, constructorArgs, deployer);
    const gasUsed = await getDeploymentGasUsed(contract);
    TotalGasCounter.add(gasUsed);
    implementation = contract.address;
    log(`deployed at ${implementation} (gas used ${gasUsed})`);
  } else {
    log(`Using pre-deployed implementation of ${artifactName}: ${implementation}`);
  }

  const proxyConstructorArgs = [implementation, proxyOwner, "0x"];
  log.lineWithArguments(
    `Deploying ${PROXY_CONTRACT_NAME} for ${artifactName} with constructor args: `,
    proxyConstructorArgs,
  );
  const proxy = await deployContract(PROXY_CONTRACT_NAME, proxyConstructorArgs, deployer);
  const gasUsed = await getDeploymentGasUsed(proxy);
  TotalGasCounter.add(gasUsed);
  log(`deployed at ${proxy.address} (gas used ${gasUsed})`);
  log.emptyLine();

  if (nameInState) {
    updateObjectInState(nameInState, {
      proxy: {
        contract: await getContractPath(PROXY_CONTRACT_NAME),
        address: proxy.address,
        constructorArgs: proxyConstructorArgs,
      },
      implementation: {
        contract: await getContractPath(artifactName),
        address: implementation,
        constructorArgs: constructorArgs,
      },
    });
  }

  return proxy;
}

export async function updateProxyImplementation(
  nameInState: string,
  artifactName: string,
  proxyAddress: string,
  proxyOwner: string,
  constructorArgs: unknown[],
) {
  const implementation = await deployContract(artifactName, constructorArgs, proxyOwner);
  const gasUsed = await getDeploymentGasUsed(implementation);
  // TODO: unify call levels where gas counter used
  TotalGasCounter.add(gasUsed);

  const proxy = await getContractAt(PROXY_CONTRACT_NAME, proxyAddress);
  await makeTx(proxy, "proxy__upgradeTo", [implementation.address], { from: proxyOwner });

  updateObjectInState(nameInState, {
    implementation: {
      contract: implementation.contractPath,
      address: implementation.address,
      constructorArgs: constructorArgs,
    },
  });
}
