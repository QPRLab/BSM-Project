import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatEther, formatUnits, parseEther } from "viem";
import { ethers } from 'ethers';

/*
 * Liquidation + Auction integration test
 * - Deploy minimal set of contracts
 * - Mint position for a user
 * - Drive price down to trigger liquidation
 * - Call `bark` to create auction
 * - Let a bidder buy underlying via `AuctionManager.purchaseUnderlying`
 * - Assert auction and liquidation state changes
 */

describe("Liquidation + Auction integration", function () {
  let deployer: any;
  let keeper: any;
  let bidder1: any;
  let bidder2: any;
  let liquidatedUser: any;
  let publicClient: any;

  // contracts
  let wltc: any;
  let stableToken: any;
  let multiLeverageToken: any;
  let interestManager: any;
  let oracle: any;
  let custodian: any;
  let auctionManager: any;
  let liquidationManager: any;
  let priceCalculator: any;

  before(async () => {
    const { viem } = await network.connect();
    publicClient = await viem.getPublicClient();
    const walletClients = await viem.getWalletClients();
    // pick a few wallet clients from the local Hardhat provider
    deployer = walletClients[0];
    keeper = walletClients[1] || walletClients[0];
    bidder1 = walletClients[2] || walletClients[0];
    bidder2 = walletClients[3] || walletClients[0];
    liquidatedUser = walletClients[4] || walletClients[0];

    // Deploy tokens and core contracts (names match existing artifacts)
    wltc = await viem.deployContract("WLTCMock", []);
    stableToken = await viem.deployContract("StableToken", []);
    multiLeverageToken = await viem.deployContract("MultiLeverageToken", ["https://api.example.com/metadata/"]);

    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);

    // Oracle initial price 100
    oracle = await viem.deployContract("LTCPriceOracle", [parseEther("100"), [deployer.account.address]]);

    // Custodian, AuctionManager, LiquidationManager
    custodian = await viem.deployContract("CustodianFixed", [wltc.address, stableToken.address, multiLeverageToken.address]);
    auctionManager = await viem.deployContract("AuctionManager", [stableToken.address, custodian.address]);
    liquidationManager = await viem.deployContract("LiquidationManager", [multiLeverageToken.address, custodian.address]);

   // simple price calculator (LinearDecrease) - choose tau large enough
   // LinearDecrease constructor expects (uint256 _tau, address auctionAddr)
   priceCalculator = await viem.deployContract("LinearDecrease", [3600n, auctionManager.address]);

    // initialize contracts (use deployer as admin)
    await interestManager.write.initialize([multiLeverageToken.address, custodian.address]);
    await stableToken.write.setCustodian([custodian.address]);
    await multiLeverageToken.write.setCustodian([custodian.address]);

    // initialize custodian: grant auction/liquidation roles inside
    await custodian.write.initialize([interestManager.address, oracle.address, auctionManager.address, liquidationManager.address]);

    // 时间相关参数（秒）
    const TIME_PARAMS = {
        ONE_HOUR: 3600,
        TWO_HOURS: 7200,
        TWENTY_FOUR_HOURS: 86400
    };
    // 价格计算器参数
    const PRICE_CALCULATOR_PARAMS = {
        TAU: TIME_PARAMS.TWO_HOURS          // 线性递减时间参数
    };
    // 拍卖管理器参数
    const AUCTION_PARAMS = {
        PRICE_MULTIPLIER: "1.0",           // 起始价格乘数
        RESET_TIME: TIME_PARAMS.TWO_HOURS,  // 重置时间
        MIN_AUCTION_AMOUNT: "1",          // 最小拍卖金额 (reduced so test purchases are allowed)
        PRICE_DROP_THRESHOLD: "0.8",        // 价格下降阈值
        PERCENTAGE_REWARD: "0.01",          // 百分比激励 (1%)
        FIXED_REWARD: "10"                  // 固定激励
    };
    // initialize auction manager (set price calculator and liquidation manager)
    // parameters: liquidationManager_, priceCalculator_, priceMultiplier_, resetTime_, priceDropThreshold_, percentageReward_, fixedReward_, minAuctionAmount_
    await auctionManager.write.initialize([
             liquidationManager.address, 
             priceCalculator.address,
             ethers.parseEther(AUCTION_PARAMS.PRICE_MULTIPLIER),
             AUCTION_PARAMS.RESET_TIME, 
             ethers.parseEther(AUCTION_PARAMS.PRICE_DROP_THRESHOLD),
             ethers.parseEther(AUCTION_PARAMS.PERCENTAGE_REWARD),
             ethers.parseEther(AUCTION_PARAMS.FIXED_REWARD),
             ethers.parseEther(AUCTION_PARAMS.MIN_AUCTION_AMOUNT)
            ]);

    // 清算管理器参数
    const LIQUIDATION_PARAMS = {
        ADJUSTMENT_THRESHOLD: "0.5",        // 调整阈值
        LIQUIDATION_THRESHOLD: "0.3",       // 清算阈值
        PENALTY: "0.03"                     // 惩罚金 (3%)
    };             
    // initialize liquidation manager with auction address and some thresholds
    await liquidationManager.write.initialize([
        auctionManager.address, 
        ethers.parseEther(LIQUIDATION_PARAMS.ADJUSTMENT_THRESHOLD),
        ethers.parseEther(LIQUIDATION_PARAMS.LIQUIDATION_THRESHOLD),
        ethers.parseEther(LIQUIDATION_PARAMS.PENALTY)
    ]);

    // quick sanity: print addresses (useful when running tests)
    console.log("Deployer:", deployer.account.address);
    console.log("Keeper:", keeper.account.address);
    console.log("Bidder1:", bidder1.account.address);
    console.log("LiquidatedUser:", liquidatedUser.account.address);


    //==================给deployer铸币===================================
    //1. 铸币10000个WLTC给deployer,bidder1,bidder2,liquidatedUser
    const mintAmount = parseEther("10000");
    let tx = await wltc.write.mint([deployer.account.address, mintAmount]);//depolyer
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await wltc.write.mint([bidder1.account.address, mintAmount]);//bidder1
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await wltc.write.mint([bidder2.account.address, mintAmount]);//bidder2
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await wltc.write.mint([liquidatedUser.account.address, mintAmount]);//liquidatedUser
    await publicClient.waitForTransactionReceipt({ hash: tx });
    //2. approve custodian
    tx = await deployer.writeContract({ address: wltc.address, abi: wltc.abi, functionName: "approve",
       args: [custodian.address, mintAmount] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await bidder1.writeContract({ address: wltc.address, abi: wltc.abi, functionName: "approve",
       args: [custodian.address, mintAmount] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await bidder2.writeContract({ address: wltc.address, abi: wltc.abi, functionName: "approve",
       args: [custodian.address, mintAmount] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await liquidatedUser.writeContract({ address: wltc.address, abi: wltc.abi, functionName: "approve",
       args: [custodian.address, mintAmount] });
    await publicClient.waitForTransactionReceipt({ hash: tx });


    //3. mint 100 wltc to stable token & multiLeverageToken via custodian, 1S1L & P0=100
    //   get 5000 stable token & 5000 multiLeverageToken
    const usedAmount = parseEther("100");
    const mintPrice = parseEther("100");
    tx = await deployer.writeContract({ address: custodian.address, abi: custodian.abi, functionName: "mint",
       args: [usedAmount, mintPrice, 2n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await bidder1.writeContract({ address: custodian.address, abi: custodian.abi, functionName: "mint",
       args: [usedAmount, mintPrice, 2n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    tx = await bidder2.writeContract({ address: custodian.address, abi: custodian.abi, functionName: "mint",
       args: [usedAmount, mintPrice, 2n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    
    /* ***************************************************************************************
     * liquidatedUser mint 10 WLTC，@ mintPrice = 100，Leverage Tpye = Aggressive(this is 1S1L) 
     * liquidatedUsde will get 500 stable token & 500 multiLeverageToken
     * ***************************************************************************************
    */
    let liquidatedLWTC = parseEther("10");
    tx = await liquidatedUser.writeContract({ address: custodian.address, abi: custodian.abi, functionName: "mint",
       args: [liquidatedLWTC, mintPrice, 2n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    
    //4. transfer 1000 stable token to custodian
    tx = await deployer.writeContract({ address: stableToken.address, abi: stableToken.abi, functionName: "transfer",
       args: [custodian.address, parseEther("1000")] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    //==================给deployer铸币===================================
    
    console.log("----------------------------------------------------------");
    console.log("Setup complete:");
    console.log("liquidatedUser mint 10 WLTC，@ mintPrice = 100，Leverage Tpye = Aggressive(this is 1S1L) ");
    console.log("liquidatedUser will get 500 stable token & 500 multiLeverageToken");
    console.log("----------------------------------------------------------");
  });

  it("test Liquidation & Auction", async () => {

    let liquidatedLtoken = parseEther("500");

    //调用getAllLeverageTokenInfo输出用户的token id
    const tokenInfo = await custodian.read.getAllLeverageTokenInfo([liquidatedUser.account.address]);
    const tokenId = tokenInfo[0][0] as bigint;
    console.log("User's Leverage Token ID:", tokenId);

    let result = await custodian.read.getSingleLeverageTokenInfo([liquidatedUser.account.address, tokenId]);
    let liquidatedBalance = result[0] as bigint;
    console.log("User's Leverage Token Balance:", ethers.formatEther(liquidatedBalance));
    assert.equal(liquidatedBalance, liquidatedLtoken, "Liquidated L token balance should be 500");

    console.log("adjust underlying price to trigger liquidation: 100 -> 80 -> 60");
    // 输出净值
    result = await custodian.read.getSingleLeverageTokenNavV2([liquidatedUser.account.address, tokenId]);
    let grossNav = result[1] as bigint;
    let netNav = result[2] as bigint;
    console.log("Gross NAV(LTC = 100):", ethers.formatEther(grossNav));
    console.log("Net NAV(LTC = 100):", ethers.formatEther(netNav));

    // drive price down so NAV falls below liquidation threshold
    let tx = await oracle.write.updatePrice([parseEther("80")]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    // 输出净值
    result = await custodian.read.getSingleLeverageTokenNavV2([liquidatedUser.account.address, tokenId]);
    grossNav = result[1] as bigint;
    netNav = result[2] as bigint;
    console.log("Gross NAV(LTC = 80):", ethers.formatEther(grossNav));
    console.log("Net NAV(LTC = 80):", ethers.formatEther(netNav));    

    // 当 NAV 高于清算阈值时，调用 bark 应该被 revert
    try {
      const txBad = await keeper.writeContract({ address: liquidationManager.address, abi: liquidationManager.abi, 
        functionName: "bark", args: [liquidatedUser.account.address, tokenId, keeper.account.address] });
      await publicClient.waitForTransactionReceipt({ hash: txBad });
      assert.fail("Expected revert not received");
    } catch (err: any) {
        // 檢查錯誤訊息是否包含指定字串
        assert(
            err.message.includes("NAV above liquidation threshold"),
            `Unexpected error message: ${err.message}`
        );
    }    

    // drive price down so NAV falls below liquidation threshold
    tx = await oracle.write.updatePrice([parseEther("60")]);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    // 输出净值
    result = await custodian.read.getSingleLeverageTokenNavV2([liquidatedUser.account.address, tokenId]);
    grossNav = result[1] as bigint;
    netNav = result[2] as bigint;
    console.log("Gross NAV(LTC = 60):", ethers.formatEther(grossNav));
    console.log("Net NAV(LTC = 60):", ethers.formatEther(netNav));    
    console.log("----------------------------------------------------------");
    
    // 当 NAV 低于清算阈值时，调用 bark 应该不被 revert
    const txTrue = await keeper.writeContract({ address: liquidationManager.address, abi: liquidationManager.abi, 
      functionName: "bark", args: [liquidatedUser.account.address, tokenId, keeper.account.address] });
    await publicClient.waitForTransactionReceipt({ hash: txTrue });
    assert.ok("bark succeeded when NAV below liquidation threshold");  

    // after bark, userLiquidationStatus should indicate underLiquidation and have an auctionId
    const status = await liquidationManager.read.userLiquidationStatus([liquidatedUser.account.address, tokenId]);
    let auctionId = status[1] as bigint;
    console.log("Liquidation status after bark - auctionId:", auctionId.toString());
    let isAuctionIdActive = await auctionManager.read.isActiveAuction([auctionId]) as boolean;
    assert.ok(isAuctionIdActive, "auction should be active after bark");
    console.log("isAuctionIdActive:", isAuctionIdActive);

    // bidder1 approve custodian to allow AuctionManager/custodian to pull S
    tx = await bidder1.writeContract({ address: stableToken.address, abi: stableToken.abi, functionName: "approve", args: [custodian.address, parseEther("1000")] });
    await publicClient.waitForTransactionReceipt({ hash: tx });

        const auctionInfoBefore = await auctionManager.read.auctions([auctionId]);
    const underlyingBefore = auctionInfoBefore[1] as bigint; //剩余抵押品的数量，需要拍卖的抵押品数量
    const startingP = auctionInfoBefore[6] as bigint; //起始价格
    console.log("auctions([auctionId].underlyingAmount:", ethers.formatEther(underlyingBefore));
    console.log("auctions([auctionId].startingPrice:", ethers.formatEther(startingP));
    console.log("----------------------------------------------------------");

    console.log("Bidder1 is bidding:");
    const wltcBalanceOfBidderBeforeBidding = await wltc.read.balanceOf([bidder1.account.address]);
    const stableBalanceOfBidderBeforeBidding = await stableToken.read.balanceOf([bidder1.account.address]);
    const maxPurchase = parseEther("5"); // try to purchase 5 WLTC; parseEther:字符轉18位；ethers.formatEther(underlyingSold1)：18位轉字符
    const currentPriceArr = await auctionManager.read.getAuctionStatus([auctionId]);
    const currentPrice = currentPriceArr[1] as bigint;
    console.log("Current Price:", ethers.formatEther(currentPrice));
    console.log("Bidder1 attempts to purchase underlying amount:", ethers.formatEther(maxPurchase));
    tx = await bidder1.writeContract({ address: auctionManager.address, abi: auctionManager.abi, 
      functionName: "purchaseUnderlying", args: [auctionId, maxPurchase, currentPrice, bidder1.account.address, "0x"] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    const wltcBalanceOfBidderAfterBidding = await wltc.read.balanceOf([bidder1.account.address]);
    const stableBalanceOfBidderAfterBidding = await stableToken.read.balanceOf([bidder1.account.address]);
   console.log("Bidder1 purchase results:");

   console.log("The wltc amount (bidder1 buy) : ",ethers.formatEther(wltcBalanceOfBidderAfterBidding-wltcBalanceOfBidderBeforeBidding) )
   console.log("The stable amount (bidder1 spend) : ", ethers.formatEther(stableBalanceOfBidderBeforeBidding - stableBalanceOfBidderAfterBidding))
   const auctionInfoAfterBid1 = await auctionManager.read.auctions([auctionId]);
   const underlyingSold1 = auctionInfoAfterBid1[2] as bigint; // sold underlying so far
   console.log("----------------------------------------------------------");
   isAuctionIdActive = await auctionManager.read.isActiveAuction([auctionId]) as boolean;
   if (!isAuctionIdActive) {
      console.log("isAuctionIdActive:", isAuctionIdActive);
      console.log("Auction ended");
      // assert.ok(underlyingSold1 === underlyingBefore, "expected some underlying sold");
   }
   else
   {


   }
   // console.log("...Bider2 is bidding ...");
   // if (underlyingSold1 >= underlyingBefore) {
   //    console.log("Auction fully filled After Bid1");
   //    // sold should be equal to the original available underlying (or equal to maxPurchase when underlying <= maxPurchase)
   //    assert.ok(underlyingSold1 === underlyingBefore, "expected some underlying sold");
   // } 
   // else {
   //    // Auction still active — proceed with second bidder
   //    // bidder2 approve custodian to allow AuctionManager/custodian to pull S
   //    tx = await bidder2.writeContract({ address: stableToken.address, abi: stableToken.abi, functionName: "approve", args: [custodian.address, parseEther("1000")] });
   //    await publicClient.waitForTransactionReceipt({ hash: tx });

   //    tx = await bidder2.writeContract({ address: auctionManager.address, abi: auctionManager.abi, 
   //       functionName: "purchaseUnderlying", args: [auctionId, maxPurchase, currentPrice, bidder2.account.address, "0x"] });
   //    await publicClient.waitForTransactionReceipt({ hash: tx });

   //    const auctionInfoRemaining = await auctionManager.read.auctions([auctionId]);
   //    const underlyingSold2 = auctionInfoRemaining[2] as bigint;
   //    const underlyingRemaining = auctionInfoRemaining[1] as bigint;
   //    console.log("Underlying sold in auction - stage 2:", ethers.formatEther(underlyingSold2));
   //    console.log("Auction info Remaining - underlyingAmount:", ethers.formatEther(underlyingRemaining));

   //    // After stage2 the sold underlying should have increased and remaining should be 0
   //    // assert.ok(underlyingSold2 > underlyingSoldBid1, "expected sold underlying to increase after stage 2");
   //    // assert.ok(underlyingRemaining === 0n, "expected remaining underlying to be zero after stage 2");
   // }


   //    // 竞拍者获得 WLTC 检查
   //    const finalBidder1WLTC = await wltc.read.balanceOf([bidder1.account.address]);
   //    const finalBidder2WLTC = await wltc.read.balanceOf([bidder2.account.address]);
   //    console.log(`Final bidder1 WLTC: ${ethers.formatEther(finalBidder1WLTC as bigint)}`);
   //    console.log(`Final bidder2 WLTC: ${ethers.formatEther(finalBidder2WLTC as bigint)}`);

   //    // 系统整体状态检查（活跃拍卖数）
   //    try {
   //       const activeAuctionCount = await auctionManager.read.getActiveAuctionCount([]);
   //       console.log(`Active auction count: ${activeAuctionCount}`);
   //    } catch (e : any) {
   //       console.log("Could not read active auction count:", e?.message ?? e);
   //    }

  });
});
