import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * 清算拍卖测试脚本
 * 测试完整的清算拍卖流程：
 * 1. 使用已有部署的合约
 * 2. 创建用户并铸币
 * 3. 模拟价格下跌触发清算
 * 4. 启动拍卖
 * 5. 参与拍卖购买底层资产
 * 6. 验证清算结果
 */

async function main() {
    console.log("🚀 开始清算拍卖测试...");

    // 连接到网络
    const { ethers } = await network.connect();

    // 获取多个测试账户
    const [deployer, liquidatedUser, keeper, bidder1, bidder2] = await ethers.getSigners();
    console.log(`📝 测试账户:`);
    console.log(`  部署者: ${deployer.address}`);
    console.log(`  被清算用户: ${liquidatedUser.address}`);
    console.log(`  Keeper (发起拍卖): ${keeper.address}`);
    console.log(`  竞拍者1: ${bidder1.address}`);
    console.log(`  竞拍者2: ${bidder2.address}`);

    // 获取当前文件的目录路径
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // 加载部署信息
    const deploymentFile = path.join(__dirname, 'deployments/deployment-localhost-latest.json');
    let deploymentInfo;

    try {
        deploymentInfo = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
        console.log("📄 加载部署信息成功");
    } catch (error) {
        console.log("❌ 无法加载部署信息，将使用默认地址...");
        console.log("请先运行部署脚本: npx hardhat run scripts/liquidation_deploy.js --network localhost");
        return;
    }

    // 获取合约实例
    const {
        wltc,
        stableToken,
        leverageToken,
        interestManager,
        priceOracle,
        custodian,
        linearDecrease,
        auctionManager,
        liquidationManager
    } = deploymentInfo.contracts;

    // 获取合约工厂用于连接
    const WLTCMock = await ethers.getContractFactory("WLTCMock");
    const StableToken = await ethers.getContractFactory("StableToken");
    const MultiLeverageToken = await ethers.getContractFactory("MultiLeverageToken");
    const CustodianFixed = await ethers.getContractFactory("CustodianFixed");
    const LTCPriceOracle = await ethers.getContractFactory("LTCPriceOracle");
    const AuctionManager = await ethers.getContractFactory("AuctionManager");
    const LiquidationManager = await ethers.getContractFactory("LiquidationManager");

    // 连接合约实例
    const wltcContract = WLTCMock.attach(wltc);
    const stableTokenContract = StableToken.attach(stableToken);
    const leverageTokenContract = MultiLeverageToken.attach(leverageToken);
    const custodianContract = CustodianFixed.attach(custodian);
    const priceOracleContract = LTCPriceOracle.attach(priceOracle);
    const auctionManagerContract = AuctionManager.attach(auctionManager);
    const liquidationManagerContract = LiquidationManager.attach(liquidationManager);

    const custodianAddr = await custodianContract.getAddress();

    console.log("\n🧪 开始测试...");


    console.log("\n 设置预言机价格...");
    const initialPrice = ethers.parseEther("100"); 
    await priceOracleContract.updatePrice(initialPrice);
    console.log(`✅ 初始价格设置为 $${ethers.formatEther(initialPrice)}`);

  // ==================== 测试1: 准备测试环境 ====================
  console.log("\n📦 测试1: 准备测试环境");

  // 1.1 给所有用户分配 WLTC
  console.log("  1.1 分配 WLTC 给所有用户...");
  const wltcAmount = ethers.parseEther("500");
  await wltcContract.mint(liquidatedUser.address, wltcAmount);
  // await wltcContract.mint(keeper.address, wltcAmount);
  // await wltcContract.mint(bidder1.address, wltcAmount);
  // await wltcContract.mint(bidder2.address, wltcAmount);

  
  console.log(`    被清算用户 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(liquidatedUser.address))} WLTC ✅`);
  console.log(`    Keeper WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(keeper.address))} WLTC ✅`);
  console.log(`    竞拍者1 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder1.address))} WLTC ✅`);
  console.log(`    竞拍者2 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder2.address))} WLTC ✅`);

  // 1.2 用户授权 Custodian 使用 WLTC
  console.log("  1.2 用户授权 Custodian 使用 WLTC...");
  await wltcContract.connect(liquidatedUser).approve(custodianAddr, wltcAmount);
  // await wltcContract.connect(keeper).approve(custodianAddr, wltcAmount);
  // await wltcContract.connect(bidder1).approve(custodianAddr, wltcAmount);
  // await wltcContract.connect(bidder2).approve(custodianAddr, wltcAmount);
  console.log("    授权完成 ✅");

  // 1.3 给竞拍者铸造稳定币用于拍卖
  console.log("  1.3 给竞拍者稳定币用于拍卖...");
  const stableTokenAmount = ethers.parseEther("10000");
  
  // 使用部署者账户直接铸造稳定币给竞拍者
  console.log("    使用部署者账户铸造稳定币...");
  const wltcAmountForDeployer = ethers.parseEther("1000000");
  await wltcContract.mint(deployer.address, wltcAmountForDeployer );
  await wltcContract.connect(deployer).approve(custodianAddr, wltcAmountForDeployer);
  await custodianContract.connect(deployer).mint(   wltcAmountForDeployer,
    ethers.parseEther("100"),
    1,)
  await stableTokenContract.connect(deployer).transfer(bidder1.address, stableTokenAmount);
  await stableTokenContract.connect(deployer).transfer(bidder2.address, stableTokenAmount);

  const originalDeficit = await custodianContract.deficit();


  console.log(`    竞拍者1 S 代币余额: ${ethers.formatEther(await stableTokenContract.balanceOf(bidder1.address))} S`);
  console.log(`    竞拍者2 S 代币余额: ${ethers.formatEther(await stableTokenContract.balanceOf(bidder2.address))} S`);


  // ==================== 测试2: 创建高风险代币 ====================
  console.log("\n📦 测试2: 创建L代币");

  // 2.1 设置高价格进行铸币

  
  const underlyingAmount = ethers.parseEther("10");
  const mintPrice = ethers.parseEther("100");
  const leverageType = 2;

  console.log("  2.1 被清算用户执行铸币...");
  const mintTx = await custodianContract.connect(liquidatedUser).mint(
    underlyingAmount,
    mintPrice,
    leverageType,
  );
  await mintTx.wait();
  console.log("    铸币成功 ✅");

  // 2.3 检查铸币结果
  console.log("  2.2 检查铸币结果...");
  const userTokens = await custodianContract.getAllLeverageTokenInfo(liquidatedUser.address);
  console.log(`    消耗LTC数量: ${ethers.formatEther(underlyingAmount)} `);
  console.log(`    铸币价格: ${ethers.formatEther(mintPrice)} `);
  if (leverageType == 2){
    console.log(`    铸造S数量: ${ethers.formatEther(userTokens[1][0])} `);
  } else if (leverageType == 1){
    console.log(`    铸造S数量: ${ethers.formatEther(ethers.formatEther(userTokens[1][0])/4n)} `);
  }
  else if (leverageType == 0){
    console.log(`    铸造S数量: ${ethers.formatEther(ethers.formatEther(userTokens[1][0])/8n)} `);  
  }
  console.log(`    铸造L数量 ${ethers.formatEther(userTokens[1][0])} `);
  console.log(`    L 代币ID: ${userTokens[0][0]} `);
  console.log(`    铸币价格: ${ethers.formatEther( mintPrice)} `);
  console.log(`    杠杆比例: ${leverageType} `);


    const tokenId = userTokens[0][0];
    // 获取净值信息
    const navInfo = await custodianContract.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`      净值信息:`);
    console.log(`      净值: ${ethers.formatEther(navInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(navInfo[2])}`);
    console.log(`      当前LTC价格: ${ethers.formatEther(navInfo[6])}`);



 // ==================== 测试3: 触发清算条件 ====================
  console.log("\n📦 测试3: 触发清算条件");


    // 3.1 设置极低价格来大幅降低净值
    console.log("  3.1 LTC价格下降...");
    const low_price = "60";
    await priceOracleContract.updatePrice(ethers.parseEther(low_price ));
    console.log(`    📝 设置预言机价格为 ${low_price} (触发高风险)`    );

    // 3.2 获取极低价格下的净值
    console.log("  3.2 获取价格下降后的净值信息...");
    const lowPriceNavInfo = await custodianContract.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`    价格下降后净值信息:`);
    console.log(`      净值: ${ethers.formatEther(lowPriceNavInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(lowPriceNavInfo[2])}`);
    console.log(`      当前LTC价格: ${ethers.formatEther(lowPriceNavInfo[6])}`);







  // ==================== 测试4: 发起清算 ====================
  console.log("\n📦 测试4: 发起清算");

    const userStatus = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);

    let AuctionID;
    let StartingPrice;
    let remaining;
    let penalty;
    let rewardLTC;
    let liquidationLAmount = ethers.formatEther(userTokens[1][0]);
    const CustodianLTCBalance0 = await wltcContract.balanceOf(custodianAddr);
    let bidder1Purchsed;
    let bidder2Purchsed;
    let bidder1Paid;
    let bidder2Paid;
    
    console.log("  4.1 Keeper 发起清算...");
    
    try {
      // Keeper 发起清算
      console.log("    Keeper调用bark函数");
      const barkTx = await liquidationManagerContract.connect(keeper).bark(
        liquidatedUser.address,
        tokenId,
        keeper.address
      );
      const receipt = await barkTx.wait();
      console.log("    📝 清算交易已发送");
      
      // 查找清算事件 - 改进的事件查找逻辑
      console.log("    查找 AuctionStarted 事件...");
      let auctionEvent = null;
      
      // 方法1: 使用 fragment 查找
      auctionEvent = receipt.logs.find(log => 
        log.fragment && log.fragment.name === "AuctionStarted"
      );

      // 方法2: 如果方法1失败，尝试通过事件签名查找
      if (!auctionEvent) {
        const auctionManagerInterface = auctionManagerContract.interface;
        const auctionStartedTopic = auctionManagerInterface.getEvent("AuctionStarted").topicHash;
        auctionEvent = receipt.logs.find(log => 
          log.topics && log.topics[0] === auctionStartedTopic
        );
      }

      if (auctionEvent) {
        console.log("    ✅ 找到 AuctionStarted 事件");
        
        let auctionId, valueToBeBurned, startingPrice,  originalOwner, tokenId, triggerer, rewardValue;
        
        try {
          // 方法1: 尝试直接使用 args
          if (auctionEvent.args && Array.isArray(auctionEvent.args) && auctionEvent.args.length > 0) {
            console.log("    使用 args 解析...");
            [auctionId, valueToBeBurned, startingPrice, originalOwner, tokenId, triggerer, rewardValue] = auctionEvent.args;
          } 
          // 方法2: 尝试使用 fragment 解析
          else if (auctionEvent.fragment) {
            console.log("    使用 fragment 解析...");
            const parsed = auctionManagerContract.interface.decodeEventLog(auctionEvent.fragment, auctionEvent.data, auctionEvent.topics);
            auctionId = parsed.auctionId;
            startingPrice = parsed.startingPrice;
            valueToBeBurned = parsed.valueToBeBurned; 
            originalOwner = parsed.originalOwner;
            tokenId = parsed.tokenId;
            triggerer = parsed.triggerer;
            rewardValue = parsed.rewardValue;
          }
          // 方法3: 尝试手动解析
          else {
            console.log("    使用手动解析...");
            const parsed = auctionManagerContract.interface.parseLog(auctionEvent);
            auctionId = parsed.args.auctionId;
            startingPrice = parsed.args.startingPrice;
            valueToBeBurned = parsed.args.valueToBeBurned; 
            originalOwner = parsed.args.originalOwner;
            tokenId = parsed.args.tokenId;
            triggerer = parsed.args.triggerer;
            rewardValue = parsed.args.rewardValue;
          }
          AuctionID = auctionId;
          StartingPrice =parseFloat(  ethers.formatEther(startingPrice));
          
          console.log(`    📊 AuctionStarted 事件详情:`);
          console.log(`      拍卖 ID: ${auctionId}`);
          console.log(`      拍卖LTC起始价格: ${ethers.formatEther(startingPrice)}`);
          console.log(`      拍卖目标: ${ethers.formatEther(valueToBeBurned)}(需要销毁的稳定币数量)`);
          console.log(`      被清算用户: ${originalOwner}`);
          console.log(`      Token ID: ${tokenId}`);
          console.log(`      Keeper: ${triggerer}`);
          console.log(`      奖励keeper: ${ethers.formatEther(rewardValue)} dollars (in the form of LTC) `);
          
        } catch (parseError) {
          console.log(`    ❌ 事件解析失败: ${parseError.message}`);
          console.log("    尝试原始数据解析...");
          
          // 如果所有方法都失败，显示原始数据
          console.log("    原始事件数据:");
          console.log(JSON.stringify(auctionEvent, null, 2));
        }
      } else {
        console.log("    ⚠️ 未找到 AuctionStarted 事件");
        console.log("    可能的原因:");
        console.log("      1. 拍卖未成功启动");
        console.log("      2. 事件签名不匹配");
        console.log("      3. 合约调用失败");
      }
      
      console.log("\n🏷️  4.2 清算细节解读");
      console.log("=" .repeat(80));
      // 检查token余额减少
      const l_nav_value = lowPriceNavInfo[2];
      const qty_value = userTokens[1][0];
      let s_qty;
      if (leverageType == 2){
        s_qty = qty_value;
      } else if (leverageType == 1){
        s_qty = qty_value / 4n;
      } else if (leverageType == 0){
        s_qty = qty_value / 8n;
      }
      // 计算和显示清算详细信息
      const l_amount = parseFloat(ethers.formatEther(qty_value));
      const l_nav = parseFloat(ethers.formatEther(l_nav_value));
      const s_amount = parseFloat(ethers.formatEther(s_qty));
      const total = l_nav * l_amount + s_amount * 1;
      const original_value = parseFloat(ethers.formatEther(underlyingAmount)) * parseFloat(ethers.formatEther(lowPriceNavInfo[6]));

      const globalConfig = await liquidationManagerContract.globalConfig();
      const penaltyRate = parseFloat(ethers.formatEther(globalConfig.penalty));

      const auctionParams = await auctionManagerContract.auctionParams();
      const fixedReward = parseFloat(ethers.formatEther(auctionParams.fixedReward));
      const percentageReward = parseFloat(ethers.formatEther(auctionParams.percentageReward));
      const minPurchaseAmount = parseFloat(ethers.formatEther(auctionParams.minAuctionAmount));

      const P0 = StartingPrice;
      const ltcNeeded = s_amount / P0;
      const reward = ltcNeeded <= minPurchaseAmount ? fixedReward : fixedReward + percentageReward * (s_amount - minPurchaseAmount * P0);

      const current_price = parseFloat(low_price);

      const auctionInfo = await auctionManagerContract.auctions(AuctionID);

      // 美化输出：清算价值计算
      console.log("\n💰 清算价值分析");
      console.log("-".repeat(50));
      const totalValue = total;
      const originalValue = original_value;
      console.log(`总清算价值: ${totalValue.toFixed(4)} dollars`);
      console.log(`│  ├── L代币价值: ${l_amount.toFixed(4)} × ${l_nav.toFixed(4)} = ${(l_amount * l_nav).toFixed(4)}`);
      console.log(`│  └── S代币价值: ${s_amount.toFixed(4)} × 1.0000 = ${s_amount.toFixed(4)}`);
      console.log(`LTC原始价值: ${originalValue.toFixed(4)} dollars)`);

      // 美化输出：惩罚与返还
      console.log("\n⏳ 惩罚金扣除与返还计算");
      console.log("-".repeat(50));
      const penaltyAmount = penaltyRate * l_amount;
      penalty = penaltyAmount / current_price;
      const remainingValue = l_amount * l_nav - penaltyAmount;
      const ltcReturned = remainingValue / current_price;
      remaining = ltcReturned;
      console.log(`清算L代币总量: ${l_amount.toFixed(4)}`);
      console.log(`惩罚比例: ${penaltyRate.toFixed(6)} (每L代币)`);
      console.log(`惩罚金扣除: 惩罚比例 * 清算L代币总量 = ${penaltyAmount.toFixed(4)} dollars`);
      console.log(`返还价值: L代币价值 - 惩罚金 =  ${remainingValue.toFixed(4)} dollars`);
      console.log(`LTC返还量: ${ltcReturned.toFixed(4)} LTC (按 ${current_price} 美元/LTC 兑换)`);

      // 美化输出：拍卖准备
      console.log("\n🏛️ 拍卖准备分析");
      console.log("-".repeat(50));
      console.log(`待销毁稳定币: ${s_amount.toFixed(4)} S`);
      console.log(`拍卖起始价: ${P0.toFixed(4)} dollars/LTC`);
      console.log(`预计出售LTC: ${ltcNeeded.toFixed(4)} LTC (至少)`);

      // 美化输出：Keeper奖励
      console.log("\n🏆 Keeper奖励计算");
      console.log("-".repeat(50));
      console.log(`最小购买量: ${minPurchaseAmount.toFixed(4)}`);
      console.log(`所需LTC量: ${ltcNeeded.toFixed(4)}`);
      if (ltcNeeded <= minPurchaseAmount) {
          console.log(`奖励类型: 固定奖励`);
          console.log(`奖励金额: ${reward.toFixed(4)} dollars`);
      } else {
          console.log(`奖励类型: 固定奖励 + 百分比奖励`);
          console.log(`固定奖励: ${fixedReward.toFixed(4)} dollars`);
          console.log(`百分比奖励: ${(percentageReward * (s_amount - minPurchaseAmount * P0)).toFixed(4)} dollars`);
          console.log(`总奖励: ${reward.toFixed(4)} dollars`);
      }
      console.log(`LTC等值奖: ${(reward / current_price).toFixed(4)} LTC`);

      // 美化输出：LTC分配
      console.log("\n🔄 LTC分配汇总");
      console.log("-".repeat(50));
      const totalUnderlying = parseFloat(ethers.formatEther(underlyingAmount));
      const ltcForUser = ltcReturned;
      const ltcForReward = reward / current_price;
      rewardLTC =ltcForReward;
      const ltcForAuction = totalUnderlying - ltcForUser - ltcForReward;
      console.log(`LTC总量: ${totalUnderlying.toFixed(4)} LTC`);
      console.log(`   ├── 用户返还: ${ltcForUser.toFixed(4)} LTC`);
      console.log(`   ├── Keeper奖励: ${ltcForReward.toFixed(4)} LTC`);
      console.log(`   └── 可拍卖LTC: ${ltcForAuction.toFixed(4)} LTC (该值需与合约记录可拍卖LTC吻合)`);
      console.log(`合约记录可拍卖LTC（underlyingAmount）: ${ethers.formatEther(auctionInfo.underlyingAmount)} LTC`);
    } catch (error) {
        console.log(`    ❌ 错误: ${error.message}`);
    }

    console.log("\n📦 测试5: 拍卖流程");
      console.log(`    拍卖 ID: ${AuctionID}`);
            // 5.1 竞拍者参与拍卖
      console.log("  5.1 检查竞拍者余额...");
      
      // 检查竞拍者稳定币余额
      const bidder1WLTCBalance0 = await wltcContract.balanceOf(bidder1.address);
      const bidder2WLTCBalance0 = await wltcContract.balanceOf(bidder2.address);
      const bidder1SBalance0 = await stableTokenContract.balanceOf(bidder1.address);
      const bidder2SBalance0 = await stableTokenContract.balanceOf(bidder2.address);


      console.log(`    竞拍者1 S 代币余额: ${ethers.formatEther(bidder1SBalance0)} S`);
      console.log(`    竞拍者1 LTC 余额: ${ethers.formatEther(bidder1WLTCBalance0 )} LTC`);
      console.log(`    竞拍者2 S 代币余额: ${ethers.formatEther(bidder2SBalance0)} S`);
      console.log(`    竞拍者2 LTC 余额: ${ethers.formatEther(bidder2WLTCBalance0)} LTC`);

      console.log("  5.2 竞拍者授权额度...");
      const stableAmountAllowed = ethers.parseEther("1000"); //授权大额度
      console.log(`    竞拍者授权custodian合约 ${parseFloat(ethers.formatEther(stableAmountAllowed))} stable coins ...`);
      await stableTokenContract.connect(bidder1).approve(custodianAddr, stableAmountAllowed);
      await stableTokenContract.connect(bidder2).approve(custodianAddr, stableAmountAllowed);
      console.log("    授权完成 ✅");

      // 5.3 竞拍者1购买底层资产
      console.log("  5.3 竞拍者1购买底层资产...");
      const auctionInfo = await auctionManagerContract.auctions(AuctionID);
      let soldUnderlyingAmount;
      soldUnderlyingAmount = auctionInfo.soldUnderlyingAmount;
      try {
          const maxPurchaseAmount1 = ethers.parseEther("3"); // 最多购买LTC数量 (如果低于最小购买量将被revert)
          const maxAcceptablePrice1 = ethers.parseEther(low_price); // 最高可接受价格为预言机当前LTC价格

          console.log(`    竞拍者1 最大购买数量: ${ethers.formatEther(maxPurchaseAmount1)} LTC`);
          console.log(`    竞拍者1 最高可接受价格: ${ethers.formatEther(maxAcceptablePrice1)} stable coins`);
          
          const purchaseTx1 = await auctionManagerContract.connect(bidder1).purchaseUnderlying(
          AuctionID,
          maxPurchaseAmount1,
          maxAcceptablePrice1,
          bidder1.address, // 接收者
          "0x" // 空调用数据
          );
          await purchaseTx1.wait();
          console.log("    竞拍者1购买成功 ✅");
          
          // 检查拍卖状态
          const auctionInfoAfterPurchase1 = await auctionManagerContract.auctions(AuctionID);
          console.log(`    购买后剩余目标: ${ethers.formatEther(auctionInfoAfterPurchase1.valueToBeBurned)} S`);

          // 检查竞拍者1获得的WLTC
          const bidder1WLTCBalance = await wltcContract.balanceOf(bidder1.address);
          const bidder1SBalance = await stableTokenContract.balanceOf(bidder1.address);

          bidder1Purchsed = bidder1WLTCBalance - bidder1WLTCBalance0;
          bidder1Paid = bidder1SBalance0 - bidder1SBalance ;
          console.log(`    竞拍者1 LTC 余额: ${ethers.formatEther(bidder1WLTCBalance)} LTC`);

          console.log(`    该笔交易系统卖掉LTC数量: ${ethers.formatEther(auctionInfoAfterPurchase1.soldUnderlyingAmount - soldUnderlyingAmount)} `);

          // 更新卖出LTC数量
          soldUnderlyingAmount = auctionInfoAfterPurchase1.soldUnderlyingAmount;
          
        } catch (error) {
            console.log(`    ⚠️ 错误: ${error.message}`);
        }
      
      // 5.4 竞拍者2购买底层资产
      console.log("  5.4 竞拍者2购买底层资产...");
      try {
          const maxPurchaseAmount2 = ethers.parseEther("10"); // 最多购买10 WLTC
          const maxAcceptablePrice2 = ethers.parseEther(low_price); // 最高可接受价格为预言机当前LTC价格

          console.log(`    竞拍者2 最大购买数量: ${ethers.formatEther(maxPurchaseAmount2)} LTC`);
          console.log(`    竞拍者2 最高可接受价格: ${ethers.formatEther(maxAcceptablePrice2)} stable coins`);
          
          const purchaseTx2 = await auctionManagerContract.connect(bidder2).purchaseUnderlying(
          AuctionID,
          maxPurchaseAmount2,
          maxAcceptablePrice2,
          bidder2.address, // 接收者
          "0x" // 空调用数据
          );
          await purchaseTx2.wait();
          console.log("    竞拍者2购买成功 ✅");
          
          // 检查拍卖状态
          const auctionInfoAfterPurchase2 = await auctionManagerContract.auctions(AuctionID);
          console.log(`    购买后剩余目标: ${ethers.formatEther(auctionInfoAfterPurchase2.valueToBeBurned)} S`);

          
          // 检查竞拍者2获得的WLTC
          const bidder2WLTCBalance = await wltcContract.balanceOf(bidder2.address);
          const bidder2SBalance = await stableTokenContract.balanceOf(bidder2.address);

          bidder2Purchsed = bidder2WLTCBalance - bidder2WLTCBalance0;
          bidder2Paid = bidder2SBalance0 - bidder2SBalance ;

          console.log(`    竞拍者2 LTC 余额: ${ethers.formatEther(bidder2WLTCBalance)} LTC`);
          console.log(`    该笔交易系统卖掉LTC数量: ${ethers.formatEther(bidder2Purchsed)} `);
          
        } catch (error) {
            console.log(`    ⚠️ 错误: ${error.message}`);
        }


        console.log("\n📦 清算流程汇总");

        // 计算汇总数据
        const deficitAfterLiquidation = await custodianContract.deficit()
        let deficitDifference = deficitAfterLiquidation  - originalDeficit;
        const CustodianLTCBalance1 = await wltcContract.balanceOf(custodianAddr);

        const liquidationLoss = deficitDifference>=0n ? deficitDifference  : 0;
        const liquidationProfit = deficitDifference<0n  ? -deficitDifference : 0;

        console.log(`被清算人:`);
        console.log(`  被清算 L: ${liquidationLAmount} L`);
        console.log(`  惩罚金: ${penalty.toFixed(4)} LTC`);
        console.log(`  自己收回 LTC: ${remaining.toFixed(4)} LTC`);

        console.log(`Keeper:`);
        console.log(`  得到奖励 : ${rewardLTC.toFixed(4)} LTC`);

        console.log(`Bidder1:`);
        console.log(`  支付 S: ${ethers.formatEther(bidder1Paid)} } S`);
        console.log(`  得到 LTC: ${ethers.formatEther(bidder1Purchsed)} LTC`);

        console.log(`Bidder2:`);
        console.log(`  支付 S: ${ethers.formatEther(bidder2Paid)} } S`);
        console.log(`  得到 LTC: ${ethers.formatEther(bidder2Purchsed)} LTC`);

        console.log(`系统:`);
        console.log(`  清算前LTC余额: ${ethers.formatEther(CustodianLTCBalance0)} LTC`);
        console.log(`  清算后LTC余额: ${ethers.formatEther(CustodianLTCBalance1)} LTC`);
        if (liquidationLoss){
          console.log(`  系统损失 LTC: ${ethers.formatEther(liquidationLoss)} LTC`);
        } else if (liquidationProfit){
          console.log(`  系统获利 LTC: ${ethers.formatEther(liquidationProfit)} LTC`);
        }




}

// 执行脚本
main()
    .then(() => {
        console.log("\n✅ 脚本执行成功");
        process.exit(0);
    })
    .catch((error) => {
        console.error("\n❌ 脚本执行失败:", error);
        process.exit(1);
    });
