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
  await wltcContract.mint(keeper.address, wltcAmount);
  await wltcContract.mint(bidder1.address, wltcAmount);
  await wltcContract.mint(bidder2.address, wltcAmount);
  
  console.log(`    被清算用户 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(liquidatedUser.address))} WLTC ✅`);
  console.log(`    Keeper WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(keeper.address))} WLTC ✅`);
  console.log(`    竞拍者1 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder1.address))} WLTC ✅`);
  console.log(`    竞拍者2 WLTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder2.address))} WLTC ✅`);

  // 1.2 用户授权 Custodian 使用 WLTC
  console.log("  1.2 用户授权 Custodian 使用 WLTC...");
  await wltcContract.connect(liquidatedUser).approve(custodianAddr, wltcAmount);
  await wltcContract.connect(keeper).approve(custodianAddr, wltcAmount);
  await wltcContract.connect(bidder1).approve(custodianAddr, wltcAmount);
  await wltcContract.connect(bidder2).approve(custodianAddr, wltcAmount);
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

  
  const underlyingAmount = ethers.parseEther("5");
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
  console.log(`    被清算用户持有 L 代币数量: ${userTokens[0].length} 种`);

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    console.log(`    L 代币 ID: ${tokenId}`);

    // 获取净值信息
    const navInfo = await custodianContract.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`      净值信息:`);
    console.log(`      净值: ${ethers.formatEther(navInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(navInfo[2])}`);
    console.log(`      Balance: ${ethers.formatEther(navInfo[0])}`);
    console.log(`      当前LTC价格: ${ethers.formatEther(navInfo[6])}`);
  }


 // ==================== 测试3: 触发清算条件 ====================
  console.log("\n📦 测试3: 触发清算条件");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];

    // 3.1 设置极低价格来大幅降低净值
    console.log("  3.1 设置极低价格大幅降低净值...");
    await priceOracleContract.updatePrice(ethers.parseEther("30"));
    console.log(`    📝 设置预言机价格为 30 (触发高风险)`    );

    // 3.2 获取极低价格下的净值
    console.log("  3.2 获取极低价格下净值信息...");
    const lowPriceNavInfo = await custodianContract.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`    极低价格下净值信息:`);
    console.log(`      总净值: ${ethers.formatEther(lowPriceNavInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(lowPriceNavInfo[2])}`);
    console.log(`      Balance: ${ethers.formatEther(lowPriceNavInfo[0])}`);
    console.log(`      当前LTC价格: ${ethers.formatEther(lowPriceNavInfo[6])}`);


    // 3.3 检查风险等级
    console.log("  3.3 检查风险等级...");
    const userStatus = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);
    console.log(`    当前风险等级: ${userStatus.riskLevel}`);
    console.log(`    冻结状态: ${userStatus.isFreezed ?  "✅" : "❌"}`);
    console.log(`    清算中: ${userStatus.isUnderLiquidation ? "✅" : "❌"}`);

    // 3.4 手动更新风险等级
    console.log("  3.4 手动更新风险等级...");
    await liquidationManagerContract.updateAllTokensRiskLevel(liquidatedUser.address) //更新风险等级


    // 3.5 再次检查风险等级
    const updatedStatus = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);
    console.log(`    最终风险等级: ${updatedStatus.riskLevel}`);
  }



  // ==================== 测试4: 发起清算 ====================
  console.log("\n📦 测试4: 发起清算");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    const userStatus = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);
    
    console.log(`    当前风险等级: ${userStatus.riskLevel}`);

    let AuctionID;
    
    // 其实这里风险等级即使不是4，keeper也可以调用bark清算，bark内置清算判断逻辑，以应对风险等级没有及时更新的情况。
    // keeper 一般链下计算净值，发现需要被清算的用户，立即调用bark。 
    if (userStatus.riskLevel == 4) {
      console.log("  4.1 Keeper 发起清算...");
      
      // 获取清算前的余额
      const beforeBalance = await leverageTokenContract.balanceOfInWei(liquidatedUser.address, tokenId);
      console.log(`    清算前 L 代币余额: ${ethers.formatEther(beforeBalance)}`);
      
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
          console.log("    方法1失败，尝试方法2...");
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
              valueToBeBurned = parsed.args.valueToBeBurned; // 注意：合约中是 underlyinglAmount
              originalOwner = parsed.args.originalOwner;
              tokenId = parsed.args.tokenId;
              triggerer = parsed.args.triggerer;
              rewardValue = parsed.args.rewardValue;
            }
            AuctionID = auctionId;
            
            console.log(`    📊 AuctionStarted 事件详情:`);
            console.log(`      拍卖 ID: ${auctionId}`);
            console.log(`      起始价格: ${ethers.formatEther(startingPrice)}`);
            console.log(`      拍卖目标: ${ethers.formatEther(valueToBeBurned)}`);
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
        
        // 4.2 检查清算结果
        console.log("  4.2 检查清算结果...");
        
        // 检查token余额减少
        const afterBalance = await leverageTokenContract.balanceOfInWei(liquidatedUser.address, tokenId);
        console.log(`    清算后 L 代币余额: ${ethers.formatEther(afterBalance)}`);
        
        // 检查用户状态
        const afterStatus = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);
        console.log(`    清算后状态:`);
        console.log(`      冻结状态: ${afterStatus.isFreezed ?  "✅" : "❌"}`);
        console.log(`      风险等级: ${afterStatus.riskLevel}`);
        
        
      } catch (error) {
        console.log(`    ❌ 清算失败: ${error.message}`);
      }
    } else {
      console.log("    风险等级不为4，无需进行清算 ✅");
    }


    console.log("\n📦 测试5: 拍卖流程");
    console.log(`    拍卖 ID: ${AuctionID}`);
    // 5.1 检查拍卖信息
    console.log("  5.1 检查拍卖信息...");
    try {
        const auctionInfo = await auctionManagerContract.auctions(AuctionID);
        const auctionStatus = await auctionManagerContract.getAuctionStatus(AuctionID);
        console.log(`    拍卖信息:`);
        console.log(`      剩余拍卖目标: ${ethers.formatEther(auctionInfo.valueToBeBurned)} S`);
        console.log(`      该次拍卖持有LTC数量: ${ethers.formatEther(auctionInfo.underlyingAmount)} LTC`)
        console.log(`      当前卖掉的LTC数量: ${ethers.formatEther(auctionInfo.soldUnderlyingAmount)} LTC`)
        console.log(`      原所有者: ${auctionInfo.originalOwner}`);
        console.log(`      Token ID: ${auctionInfo.tokenId}`);
        console.log(`      开始时间: ${auctionInfo.startTime}`);
        console.log(`      当前价格: ${ethers.formatEther(auctionStatus[1])}`);
        console.log(`      是否需要被重置: ${auctionStatus[0]? "✅" : "❌"}`);

    } catch (error) {
        console.log(`    ⚠️ 获取拍卖信息失败: ${error.message}`);
    }

    // 5.2 竞拍者参与拍卖
    console.log("  5.2 竞拍者参与拍卖...");
    
    // 检查竞拍者稳定币余额
    console.log("    检查竞拍者稳定币余额...");
    const stableAmount = ethers.parseEther("1000");
    console.log(`    竞拍者1 S 代币余额: ${ethers.formatEther(await stableTokenContract.balanceOf(bidder1.address))} S`);
    console.log(`    竞拍者1 LTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder1.address))} LTC`);
    console.log(`    竞拍者2 S 代币余额: ${ethers.formatEther(await stableTokenContract.balanceOf(bidder2.address))} S`);
    console.log(`    竞拍者2 LTC 余额: ${ethers.formatEther(await wltcContract.balanceOf(bidder2.address))} LTC`);
    // const wltcAmountBeforeBid_1 = wltcContract.balanceOf(bidder1.address);
    // const wltcAmountBeforeBid_2 = wltcContract.balanceOf(bidder2.address);


        
        // 竞拍者授权拍卖合约使用稳定币
        console.log("    竞拍者授权custodian合约...");
        await stableTokenContract.connect(bidder1).approve(custodianAddr, stableAmount);
        await stableTokenContract.connect(bidder2).approve(custodianAddr, stableAmount);
        console.log("    授权完成 ✅");
        
        // 5.3 竞拍者1购买底层资产
        console.log("  5.3 竞拍者1购买底层资产...");
        try {
            const maxPurchaseAmount1 = ethers.parseEther("1"); // 最多购买10 WLTC
            const maxAcceptablePrice1 = ethers.parseEther("100"); // 最高可接受价格29.9
            
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
            console.log(`    竞拍者1 WLTC 余额: ${ethers.formatEther(bidder1WLTCBalance)} WLTC`);
            
        } catch (error) {
            console.log(`    ⚠️ 竞拍者1购买失败: ${error.message}`);
        }
        
        // 5.4 竞拍者2购买底层资产
        console.log("  5.4 竞拍者2购买底层资产...");
        try {
            const maxPurchaseAmount2 = ethers.parseEther("10"); // 最多购买10 WLTC
            const maxAcceptablePrice2 = ethers.parseEther("80"); // 最高可接受价格80
            
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
            console.log(`    竞拍者2 WLTC 余额: ${ethers.formatEther(bidder2WLTCBalance)} WLTC`);
            
        } catch (error) {
            console.log(`    ⚠️ 竞拍者2购买失败: ${error.message}`);
        }

        // 5.5 检查用户清算信息是否被重置
        console.log("  5.5 被清算者TokenID的冻结状态");
        const afterLiquidation = await liquidationManagerContract.userLiquidationStatus(liquidatedUser.address, tokenId);
        console.log(`      清算后Token${tokenId}冻结状态: ${afterLiquidation.isFreezed ?  "✅" : "❌"}`);
        console.log(`      风险等级: ${afterLiquidation.riskLevel}`);
        if (!afterLiquidation.isFreezed){
          console.log("      清算全部完成 ✅");
          const currentDificit = await custodianContract.deficit();
          const custodianLoss = (currentDificit - originalDeficit) >0n ? ethers.formatEther((currentDificit - originalDeficit)) : 0;
          const custodianProfit = (originalDeficit - currentDificit) >0n ? ethers.formatEther((originalDeficit - currentDificit)) : 0;
            console.log(`      该次拍卖custodian补贴: ${custodianLoss}LTC`);
            console.log(`      该次拍卖custodian盈余: ${custodianProfit}LTC`);

        }
        else{
          console.log("      拍卖目标未达成 ❌");
        }

  }

// 记录当前custodian的underlying balance
  const balance_0 = await wltcContract.balanceOf(custodianAddr);
  // 记录当前custodian的赤字（wLTC）
  const deficit = await custodianContract.deficit();

  const formattedValue = deficit < 0n
  ? "-" + ethers.formatEther(-deficit)
  : ethers.formatEther(deficit);

  console.log('Custodian记录:');
  console.log(` WLTC balance:  ${ethers.formatEther(balance_0)}    `)
  console.log(` Deficit:  ${formattedValue} LTC   `)

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
