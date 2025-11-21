/*
 * 更新 Oracle 价格到市场价
 * 运行：npx tsx scripts/update_oracle_price.ts
 * 
 * 目的：将 Oracle 价格从 $120 更新到 $128，使其接近 Uniswap DEX 实际价格
 */

import { createPublicClient, createWalletClient, http, formatEther, getContract, parseEther } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 Oracle artifact 和地址
const LTCPriceOracleArtifact = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/artifacts/toolModules#LTCPriceOracle.json'), 'utf8'));
const deployedAddresses = JSON.parse(readFileSync(join(__dirname, '../ignition/deployments/chain-11155111/deployed_addresses.json'), "utf-8"));

async function main() {
  console.log("🔄 开始更新 Oracle 价格...\n");

  // 创建客户端
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('SEPOLIA_PRIVATE_KEY not found in .env');
  }
  const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(formattedPrivateKey as `0x${string}`);

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });

  // 创建 Oracle 合约实例
  const ltcOracle = getContract({
    address: deployedAddresses["toolModules#LTCPriceOracle"],
    abi: LTCPriceOracleArtifact.abi,
    client: walletClient
  });

  // 1. 查询当前价格
  console.log("📊 查询当前 Oracle 价格...");
  const currentRoundData = await ltcOracle.read.latestRoundData([]) as readonly [bigint, bigint, bigint, bigint, bigint];
  const currentPrice = currentRoundData[1]; // answer
  console.log(`当前价格: $${formatEther(currentPrice)}`);

  // 2. 设置新价格（根据 DEX 实际价格）
  const newPrice = parseEther("128"); // $128
  console.log(`\n🎯 目标价格: $${formatEther(newPrice)}`);
  
  if (currentPrice === newPrice) {
    console.log("✅ 价格已经是目标值，无需更新");
    return;
  }

  // 3. 检查是否有权限
  console.log("\n🔑 检查更新权限...");
  try {
    const owner = await ltcOracle.read.owner([]) as string;
    console.log(`Oracle Owner: ${owner}`);
    console.log(`当前账户: ${account.address}`);
    
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      console.log("❌ 当前账户不是 Oracle owner，无法更新价格");
      console.log(`请使用 owner 账户：${owner}`);
      return;
    }
  } catch (error) {
    console.log("⚠️ 无法检查 owner，继续尝试更新...");
  }

  // 4. 执行价格更新
  console.log("\n📝 执行价格更新...");
  try {
    const updateTx = await ltcOracle.write.updatePrice([newPrice]);
    console.log(`交易哈希: ${updateTx}`);
    
    console.log("⏳ 等待交易确认...");
    const receipt = await publicClient.waitForTransactionReceipt({ hash: updateTx });
    
    if (receipt.status === 'success') {
      console.log("✅ 价格更新成功！");
      
      // 5. 验证更新后的价格
      console.log("\n🔍 验证更新后的价格...");
      const updatedRoundData = await ltcOracle.read.latestRoundData([]) as readonly [bigint, bigint, bigint, bigint, bigint];
      const updatedPrice = updatedRoundData[1];
      console.log(`更新后价格: $${formatEther(updatedPrice)}`);
      
      if (updatedPrice === newPrice) {
        console.log("✅ 价格验证成功！");
        console.log("\n📌 现在可以运行 4_interact_amm_viem_Inde.ts 测试 swapUsdcToLeverage 功能了");
      } else {
        console.log("⚠️ 价格验证失败，更新后的价格与目标不符");
      }
    } else {
      console.log("❌ 交易失败");
    }
  } catch (error: any) {
    console.error("❌ 更新价格失败:", error.shortMessage || error.message);
    
    // 检查是否是权限问题
    if (error.message.includes("Not authorized") || error.message.includes("Ownable")) {
      console.log("\n💡 提示：");
      console.log("1. 确认当前账户是 Oracle owner");
      console.log("2. 或者检查 Oracle 是否有 priceFeeder 白名单机制");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 脚本失败:", error);
    process.exit(1);
  });
