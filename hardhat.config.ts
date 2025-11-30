import type { HardhatUserConfig } from "hardhat/config";
// import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable } from "hardhat/config";
import "dotenv/config";



const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
    },
  },
  networks: {
    // Local in-memory Hardhat network used by tests (network.connect()).
    // Enabling allowUnlimitedContractSize here avoids EIP-170 (24KB) code size limit
    // during unit tests for very large contracts like CustodianFixed. This does NOT
    // affect deployed networks (mainnet / testnet) where the size limit still applies.
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      allowUnlimitedContractSize: true,
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      //url: `https://1rpc.io/sepolia`,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
      // gasPrice: 30000000000,
      // timeout: 120000, // 单位毫秒
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
      // customChains: [
      // {
      //   network: "sepolia",
      //   chainId: 11155111,
      //   urls: {
      //     apiURL: "https://api-sepolia.etherscan.io/api",
      //     browserURL: "https://sepolia.etherscan.io"
      //   }
      // }]
    },
    blockscout: {
      enabled: false,
    },
  }
};

export default config;


