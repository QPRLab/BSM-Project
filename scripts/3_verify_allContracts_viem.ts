/*
 * 批量验证所有合约的脚本
 * 运行：npx tsx scripts/3_verify_allContracts_viem_Inde.ts
 * 通常情况下，我们会为每个合约单独运行 hardhat verify 命令：
 * npx hardhat verify --network <network> <contract_address> --contract <contract_source> [constructor_arguments]
 * 但是为了方便起见，这里我们编写一个脚本来自动化这个过程。
 *
 * 导出的地址常量使用方法：
 * import { CONTRACT_ADDRESSES, CONTRACT_ADDRESS_ARRAY, CONTRACT_ADDRESS_MAP } from './0_verifyAllContracts';
 *
 * // 使用对象访问
 * const wltcAddress = CONTRACT_ADDRESSES.WLTCMock;
 *
 * // 使用数组遍历
 * CONTRACT_ADDRESS_ARRAY.forEach(address => console.log(address));
 *
 * // 使用映射查找
 * const custodianAddress = CONTRACT_ADDRESS_MAP.get('CustodianFixed');
*/

import { exec } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取部署地址
const deploymentsPath = path.resolve(__dirname, "../ignition/deployments/chain-11155111/deployed_addresses.json");
const deployed = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));

// // 导出合约地址常量
// export const CONTRACT_ADDRESSES = {
//   WLTCMock: deployed["basicModules#WLTCMock"],
//   USDCMock: deployed["basicModules#USDCMock"],
//   StableToken: deployed["basicModules#StableToken"],
//   MultiLeverageToken: deployed["basicModules#MultiLeverageToken"],
//   InterestManager: deployed["basicModules#InterestManager"],
//   LTCPriceOracle: deployed["basicModules#LTCPriceOracle"],
//   CustodianFixed: deployed["basicModules#CustodianFixed"],
//   AMMLiquidity: deployed["ammModules#AMMLiquidity"],
//   AMMSwap: deployed["ammModules#AMMSwap"],
// } as const;

// // 导出地址数组
// export const CONTRACT_ADDRESS_ARRAY = Object.values(CONTRACT_ADDRESSES);

// // 导出地址映射（合约名 -> 地址）
// export const CONTRACT_ADDRESS_MAP = new Map<string, string>(
//   Object.entries(CONTRACT_ADDRESSES).map(([key, value]) => [key, value])
// );

// 合约名和源码路径映射（根据你的项目结构调整）
const contracts: { name: string; source: string; address: string }[] = [
  { name: "WLTCMock", source: "contracts/mocks/WLTCMock.sol:WLTCMock", address: deployed["tokenModules#WLTCMock"] },
  { name: "USDCMock", source: "contracts/mocks/USDCMock.sol:USDCMock", address: deployed["tokenModules#USDCMock"] },
  { name: "StableToken", source: "contracts/tokens/StableToken.sol:StableToken", address: deployed["tokenModules#StableToken"] },
  { name: "MultiLeverageToken", source: "contracts/tokens/MultiLeverageToken.sol:MultiLeverageToken", address: deployed["tokenModules#MultiLeverageToken"] },
  { name: "InterestManager", source: "contracts/InterestManager.sol:InterestManager", address: deployed["toolModules#InterestManager"] },
  { name: "LTCPriceOracle", source: "contracts/oracles/LTCPriceOracle.sol:LTCPriceOracle", address: deployed["toolModules#LTCPriceOracle"] },
  { name: "CustodianFixed", source: "contracts/CustodianFixed.sol:CustodianFixed", address: deployed["toolModules#CustodianFixed"] },
  { name: "AMMLiquidity", source: "contracts/AMMLiquidity.sol:AMMLiquidity", address: deployed["ammModules#AMMLiquidity"] },
  { name: "AMMSwap", source: "contracts/AMMSwap.sol:AMMSwap", address: deployed["ammModules#AMMSwap"] }
];

const network = "sepolia"; // 可根据需要修改

/*
  对于LTCPriceOracle合约，由于其构造函数参数较复杂（包含数组），
  我们将使用 --constructor-args-path 选项来指定一个包含构造函数参数的文件。
  下面的命令假设我们已经创建了一个名为 temp_args.cjs 的文件，内容如下：
  module.exports = [
    "120000000000000000000",  // 第一个参数
    [                          // 第二个参数（数组）
      "0x4845d4db01b81A15559b8734D234e6202C556d32",
      "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",
      "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",
      "0xA4b399a194e2DD9b84357E92474D0c32e3359A74"
    ]
  ];
  然后，我们可以使用 --constructor-args-path 选项来指定该文件：
npx hardhat verify --network sepolia <contract_address> --contract contracts/oracles/LTCPriceOracle.sol:LTCPriceOracle --constructor-args-path ./temp_args.cjs
*/

const address : string[] = deployed[`tokenModules#WLTCMock`];

const commands: string[] = [
  `npx hardhat verify --network ${network} ${deployed[`tokenModules#${contracts[0].name}`]} --contract ${contracts[0].source} `,
  `npx hardhat verify --network ${network} ${deployed[`tokenModules#${contracts[1].name}`]} --contract ${contracts[1].source} `,
  `npx hardhat verify --network ${network} ${deployed[`tokenModules#${contracts[2].name}`]} --contract ${contracts[2].source} `,
  `npx hardhat verify --network ${network} ${deployed[`tokenModules#${contracts[3].name}`]} --contract ${contracts[3].source} ` + 
    `"ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/"`,
  `npx hardhat verify --network ${network} ${deployed[`toolModules#${contracts[4].name}`]} --contract ${contracts[4].source} ` +
  `${contracts[0].address}` + ` 300`,
  `npx hardhat verify --network ${network} ${deployed[`toolModules#${contracts[5].name}`]} --contract ${contracts[5].source} ` +
  `--constructor-args-path ./temp_args.cjs`,
  `npx hardhat verify --network ${network} ${deployed[`toolModules#${contracts[6].name}`]} --contract ${contracts[6].source} ` + 
  ` ${contracts[0].address}` +
  ` ${contracts[2].address}` +
  ` ${contracts[3].address}`,
  `npx hardhat verify --network ${network} ${deployed[`ammModules#${contracts[7].name}`]} --contract ${contracts[7].source}  ` + 
    ` ${contracts[2].address}` +
    ` ${contracts[1].address}` +
    ` "Stable-USDC LP"` +
    ` "SLP"`,
  `npx hardhat verify --network ${network} ${deployed[`ammModules#${contracts[8].name}`]} --contract ${contracts[8].source} ` +
    ` ${contracts[0].address}` +
    ` ${contracts[1].address}` +
    ` ${contracts[2].address}` +
    ` ${contracts[3].address}` +
    ` "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b"` +
    ` "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3"` +
    ` "0xd1CFdAb73eF0345F437a9c33acF179BB55633094"` +
    ` "3000"`,
];

async function main(): Promise<void> {
  // 为需要构造函数参数的合约创建参数文件
  const ltcArgs = [
    "120000000000000000000",
    [
      "0x4845d4db01b81A15559b8734D234e6202C556d32",
      "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",
      "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",
      "0xA4b399a194e2DD9b84357E92474D0c32e3359A74"
    ]
  ];
  fs.writeFileSync('./temp_args.cjs', `module.exports = ${JSON.stringify(ltcArgs, null, 2)};`);

  for (let i = 0; i < 9; i++) {
    const contract = contracts[i];
    const command = commands[i];
    let deploymentKey;
    if(i < 4)
    {
      deploymentKey = `tokenModules#${contract.name}`;

    }
    else if(i < 7)
    {
      deploymentKey = `toolModules#${contract.name}`;

    }
     else {
      deploymentKey = `ammModules#${contract.name}`;
    }
    const address = deployed[deploymentKey];
    if (!address) {
      console.log(`未找到 ${contract.name} 的部署地址，跳过`);
      continue;
    }
    console.log(`正在验证 ${contract.name}，地址: ${address}`);

    // 执行命令
    await new Promise((resolve) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`验证 ${contract.name} 失败:`, stderr || error.message);
        } else {
          console.log(stdout);
        }
        resolve(null);
      });
    });
  }

  // 清理临时文件
  try {
    fs.unlinkSync('./temp_args.cjs');
  } catch (e) {
    // 忽略删除错误
  }

  console.log("所有合约验证完成。");
}


main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });

