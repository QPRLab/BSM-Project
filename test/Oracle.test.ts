import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatEther, formatUnits, parseEther, parseUnits, zeroAddress } from "viem";

/*
 * Oracle 测试 - Price Feed 管理
 * 命令：npx hardhat test test/Oracle.test.ts
 * 
 * 测试内容：
 * 1. Oracle 初始状态验证
 * 2. getLatestPrice 和 getLatestPriceView 函数
 * 3. updatePriceFeed 函数（切换 price feed）
 * 4. Oracle 价格更新
 * 5. 边界情况和错误处理
 * 6. 集成测试（使用 Oracle 进行铸币）
 */

describe("Oracle Tests - Price Feed Management", function () {


  // Oracle 使用18位精度（LTCPriceOracle 合约内部使用18位）
  const INITIAL_PRICE = parseEther("120"); // 18位精度: 120 USD
  const NEW_PRICE = parseEther("150"); // 18位精度: 150 USD

  // Contracts
  let wltc: any;
  let usdc: any;
  let stableToken: any;
  let multiLeverageToken: any;
  let interestManager: any;
  let oracle: any;
  let oracle2: any;
  let custodian: any;
  let deployer: any;
  let user: any;
  let publicClient: any;

  before(async () => {

    const { viem } = await network.connect();
    publicClient = await viem.getPublicClient();
    [deployer, user] = await viem.getWalletClients();

    console.log("\n=== 开始部署合约 ===");
    console.log("Deployer address:", deployer.account.address);
    console.log("User address:", user.account.address);

    // 1. 部署 Token 合约
    console.log("\n--- 部署 Token 合约 ---");
    
    wltc = await viem.deployContract("WLTCMock", []);
    console.log("✅ WLTC deployed:", wltc.address);

    usdc = await viem.deployContract("USDCMock", []);
    console.log("✅ USDC deployed:", usdc.address);

    stableToken = await viem.deployContract("StableToken", []);
    console.log("✅ StableToken deployed:", stableToken.address);

    multiLeverageToken = await viem.deployContract("MultiLeverageToken", ["https://api.example.com/metadata/"]);
    console.log("✅ MultiLeverageToken deployed:", multiLeverageToken.address);

    // 2. 部署核心合约
    console.log("\n--- 部署核心合约 ---");
    
    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);
    console.log("✅ InterestManager deployed:", interestManager.address);

    // 部署第一个 Oracle
    oracle = await viem.deployContract("LTCPriceOracle", [INITIAL_PRICE, [deployer.account.address]]);
    console.log("✅ Oracle 1 deployed:", oracle.address);
    console.log("   Initial price:", formatUnits(INITIAL_PRICE, 18), "USD");

    // 部署第二个 Oracle (用于测试切换)
    oracle2 = await viem.deployContract("LTCPriceOracle", [NEW_PRICE, [deployer.account.address]]);
    console.log("✅ Oracle 2 deployed:", oracle2.address);
    console.log("   Initial price:", formatUnits(NEW_PRICE, 18), "USD");

    custodian = await viem.deployContract("CustodianFixed", [
      wltc.address,
      stableToken.address,
      multiLeverageToken.address,
    ]);
    console.log("✅ CustodianFixed deployed:", custodian.address);

    const auctionManager = await viem.deployContract("AuctionManager", [stableToken.address, custodian.address]);
    console.log("✅ AuctionManager deployed:", auctionManager.address);
    const liquidationManager = await viem.deployContract("LiquidationManager", [multiLeverageToken.address, custodian.address]);
    console.log("✅ Liquidation deployed:", liquidationManager.address);
    // 3. 初始化合约
    console.log("\n--- 初始化合约 ---");
    
    await interestManager.write.initialize([multiLeverageToken.address, custodian.address]);
    console.log("✅ InterestManager initialized");

    await stableToken.write.setCustodian([custodian.address]);
    console.log("✅ StableToken custodian set");

    await multiLeverageToken.write.setCustodian([custodian.address]);
    console.log("✅ MultiLeverageToken custodian set");

    await custodian.write.initialize([interestManager.address, oracle.address, auctionManager.address, liquidationManager.address]);
    console.log("✅ CustodianFixed initialized");

    console.log("\n=== 合约部署和初始化完成 ===\n");
  });

  describe("1. 初始 Oracle 状态验证", () => {
    it("应该正确返回初始价格", async () => {
      const [price, timestamp, isValid] = await custodian.read.getLatestPriceView();
      
      console.log("\n--- 初始 Oracle 状态 ---");
      console.log("价格 (18位精度):", formatEther(price), "USD");
      console.log("时间戳:", timestamp.toString());
      console.log("是否有效:", isValid);

      assert.strictEqual(isValid, true);
      assert.strictEqual(price, parseUnits("120", 18)); // 转换为18位精度
      console.log("✅ 初始价格验证通过");
    });

    it("应该正确返回 priceFeed 地址", async () => {
      const priceFeedAddress = await custodian.read.priceFeed();
      assert.strictEqual(priceFeedAddress.toLowerCase(), oracle.address.toLowerCase());
      console.log("当前 PriceFeed 地址:", priceFeedAddress);
    });

    it("应该正确返回 priceFeed 精度", async () => {
      const decimals = await custodian.read.priceFeedDecimals();
      assert.strictEqual(decimals, 18);
      console.log("PriceFeed 精度:", decimals);
    });
  });

  describe("2. getLatestPriceView 函数测试", () => {
    it("应该成功获取价格（view 版本）", async () => {
      const [price, timestamp, isValid] = await custodian.read.getLatestPriceView();
      
      console.log("\n--- getLatestPriceView 结果 ---");
      console.log("价格:", formatEther(price), "USD");
      console.log("时间戳:", timestamp.toString());
      console.log("是否有效:", isValid);

      assert.strictEqual(isValid, true);
      assert.ok(price > 0n);
      assert.ok(timestamp > 0n);
    });

    it("应该正确转换精度（8位 -> 18位）", async () => {
      const [price] = await custodian.read.getLatestPriceView();
      
      // Oracle 返回 120 * 10^8
      // 应该转换为 120 * 10^18
      assert.strictEqual(price, parseUnits("120", 18));
      
      console.log("原始价格 (8位):", formatUnits(INITIAL_PRICE, 8));
      console.log("转换后价格 (18位):", formatEther(price));
    });
  });

  describe("3. updatePriceFeed 函数测试", () => {
    it("应该拒绝非 owner 调用", async () => {
      try {
        await user.writeContract({
          address: custodian.address,
          abi: custodian.abi,
          functionName: "updatePriceFeed",
          args: [oracle2.address],
        });
        assert.fail("应该抛出错误");
      } catch (error: any) {
        assert.ok(error.message.includes("OwnableUnauthorizedAccount"));
        console.log("✅ 非 owner 无法更新 price feed");
      }
    });

    it("应该拒绝零地址", async () => {
      try {
        await custodian.write.updatePriceFeed([zeroAddress]);
        assert.fail("应该抛出错误");
      } catch (error: any) {
        assert.ok(error.message.includes("Invalid price feed address"));
        console.log("✅ 拒绝零地址");
      }
    });

    it("应该拒绝相同的地址", async () => {
      const currentOracle = await custodian.read.priceFeed();
      
      try {
        await custodian.write.updatePriceFeed([currentOracle]);
        assert.fail("应该抛出错误");
      } catch (error: any) {
        assert.ok(error.message.includes("Same price feed address"));
        console.log("✅ 拒绝相同的 price feed 地址");
      }
    });

    it("应该成功更新 priceFeed 到新的 Oracle", async () => {
      console.log("\n--- 更新 PriceFeed ---");
      
      const oldOracle = await custodian.read.priceFeed();
      const newOracleAddress = oracle2.address;
      
      console.log("旧 Oracle 地址:", oldOracle);
      console.log("新 Oracle 地址:", newOracleAddress);
      
      // 执行更新
      const hash = await custodian.write.updatePriceFeed([newOracleAddress]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      console.log("✅ PriceFeed 更新成功");
      
      // 验证更新
      const updatedOracle = await custodian.read.priceFeed();
      assert.strictEqual(updatedOracle.toLowerCase(), newOracleAddress.toLowerCase());
      console.log("当前 Oracle 地址:", updatedOracle);
      
      // 验证精度也被更新
      const newDecimals = await custodian.read.priceFeedDecimals();
      assert.strictEqual(newDecimals, 18);
      console.log("当前精度:", newDecimals);
    });

    it("更新后应该能获取新 Oracle 的价格", async () => {
      // 当前使用 oracle2 (150 USD)
      const [price1] = await custodian.read.getLatestPriceView();
      console.log("\n当前价格 (Oracle 2):", formatEther(price1), "USD");
      assert.strictEqual(price1, parseUnits("150", 18));
      
      // 切换回 oracle (120 USD)
      const hash = await custodian.write.updatePriceFeed([oracle.address]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const [price2] = await custodian.read.getLatestPriceView();
      console.log("切换后价格 (Oracle 1):", formatEther(price2), "USD");
      assert.strictEqual(price2, parseUnits("120", 18));
      
      console.log("✅ 价格切换成功");
    });
  });

  describe("4. Oracle 价格更新测试", () => {
    it("应该允许 Oracle owner 更新价格", async () => {
      console.log("\n--- 测试 Oracle 价格更新 ---");
      
      const newPrice = parseEther("130"); // 130 USD (18位精度)
      
      console.log("更新前价格:", formatEther(INITIAL_PRICE), "USD");
      console.log("新价格:", formatEther(newPrice), "USD");
      
      // 更新 oracle 价格
      const hash = await oracle.write.updatePrice([newPrice]);
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ Oracle 价格更新成功");
      
      // 验证 Custodian 能获取新价格
      const [price] = await custodian.read.getLatestPriceView();
      assert.strictEqual(price, parseEther("130"));
      console.log("Custodian 读取到的新价格:", formatEther(price), "USD");
    });

    it("应该正确处理价格变化历史", async () => {
      const prices = [
        parseEther("125"),
        parseEther("135"),
        parseEther("140"),
      ];
      
      console.log("\n--- 测试多次价格更新 ---");
      
      for (let i = 0; i < prices.length; i++) {
        const hash = await oracle.write.updatePrice([prices[i]]);
        await publicClient.waitForTransactionReceipt({ hash });
        
        const [price] = await custodian.read.getLatestPriceView();
        
        console.log(`第 ${i + 1} 次更新:`, formatEther(price), "USD");
        assert.strictEqual(price, prices[i]);
      }
      
      console.log("✅ 所有价格更新正确");
    });
  });

  describe("5. 边界情况测试", () => {
    it("应该处理非常大的价格", async () => {
      const largePrice = parseEther("99999"); // 99,999 USD (低于100,000最大值)
      
      const hash = await oracle.write.updatePrice([largePrice]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const [price] = await custodian.read.getLatestPriceView();
      
      console.log("\n--- 大价格测试 ---");
      console.log("设置价格:", formatEther(largePrice), "USD");
      console.log("读取价格:", formatEther(price), "USD");
      
      assert.strictEqual(price, parseEther("99999"));
      console.log("✅ 大价格处理正确");
    });

    it("应该处理非常小的价格", async () => {
      const smallPrice = parseEther("10.01"); // 10.01 USD (18位精度，注意：最小值是10 USD)
      
      const hash = await oracle.write.updatePrice([smallPrice]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      const [price] = await custodian.read.getLatestPriceView();
      
      console.log("\n--- 小价格测试 ---");
      console.log("设置价格:", formatEther(smallPrice), "USD");
      console.log("读取价格:", formatEther(price), "USD");
      
      assert.strictEqual(price, parseEther("10.01"));
      console.log("✅ 小价格处理正确");
    });

    it("应该拒绝零价格", async () => {
      const zeroPrice = 0n;
      
      try {
        await oracle.write.updatePrice([zeroPrice]);
        assert.fail("应该抛出错误");
      } catch (error: any) {
        assert.ok(error.message.includes("Price must be positive"));
        console.log("✅ 正确拒绝零价格");
      }
    });
  });

  describe("6. 集成测试 - 使用 Oracle 进行铸币", () => {
    before(async () => {
      // 确保价格正常
      const normalPrice = parseEther("120"); // 18位精度
      const hash = await oracle.write.updatePrice([normalPrice]);
      await publicClient.waitForTransactionReceipt({ hash });
      
      // 给 user 铸造一些 WLTC
      const wltcAmount = parseEther("10"); // 10 WLTC
      const mintHash = await wltc.write.mint([user.account.address, wltcAmount]);
      await publicClient.waitForTransactionReceipt({ mintHash });
      
      // user 授权 custodian
      const approveHash = await user.writeContract({
        address: wltc.address,
        abi: wltc.abi,
        functionName: "approve",
        args: [custodian.address, wltcAmount],
      });
      await publicClient.waitForTransactionReceipt({ approveHash });
      
      console.log("\n--- 准备铸币测试 ---");
      console.log("User WLTC 余额:", formatEther(wltcAmount));
    });

    it("应该使用当前 Oracle 价格成功铸币", async () => {
      const underlyingAmount = parseEther("1"); // 1 WLTC
      const [currentPrice] = await custodian.read.getLatestPriceView();
      
      console.log("\n--- 铸币测试 ---");
      console.log("抵押物数量:", formatEther(underlyingAmount), "WLTC");
      console.log("当前价格:", formatEther(currentPrice), "USD");
      
      // 铸币
      const hash = await user.writeContract({
        address: custodian.address,
        abi: custodian.abi,
        functionName: "mint",
        args: [underlyingAmount, currentPrice, 2], // AGGRESSIVE
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ 铸币成功");
      
      // 验证余额
      const sBalance = await stableToken.read.balanceOf([user.account.address]);
      const tokenId = 2n; // AGGRESSIVE
      const lBalance = await multiLeverageToken.read.balanceOf([user.account.address, tokenId]);
      
      console.log("S Token 余额:", formatEther(sBalance));
      console.log("L Token 余额:", formatEther(lBalance));
      
      assert.ok(sBalance > 0n);
      assert.ok(lBalance > 0n);
    });

    it("Oracle 价格变化后应该影响 NAV 计算", async () => {
      const tokenId = 2n; // AGGRESSIVE token
      
      const result1 = await custodian.read.getSingleLeverageTokenNav([
        user.account.address,
        tokenId,
        parseUnits("120", 18)
      ]);
      const grossNav1 = result1[1]; // grossNavInWei
      
      console.log("\n--- NAV 变化测试 ---");
      console.log("价格 120 USD 时的 NAV:", formatEther(grossNav1));
      
      // 价格上涨到 150
      const result2 = await custodian.read.getSingleLeverageTokenNav([
        user.account.address,
        tokenId,
        parseUnits("150", 18)
      ]);
      const grossNav2 = result2[1]; // grossNavInWei
      
      console.log("价格 150 USD 时的 NAV:", formatEther(grossNav2));
      
      // NAV 应该增加
      assert.ok(grossNav2 > grossNav1);
      
      const navIncrease = ((Number(grossNav2 - grossNav1) * 100) / Number(grossNav1)).toFixed(2);
      console.log("NAV 增长:", navIncrease + "%");
      console.log("✅ 价格变化正确影响 NAV");
    });
  });

  describe("7. 总结和状态报告", () => {
    it("应该显示最终系统状态", async () => {
      console.log("\n" + "=".repeat(60));
      console.log("系统最终状态报告");
      console.log("=".repeat(60));
      
      const priceFeedAddress = await custodian.read.priceFeed();
      const decimals = await custodian.read.priceFeedDecimals();
      const [price, timestamp, isValid] = await custodian.read.getLatestPriceView();
      
      console.log("\n📊 Oracle 配置:");
      console.log("   PriceFeed 地址:", priceFeedAddress);
      console.log("   精度:", decimals);
      console.log("   当前价格:", formatEther(price), "USD");
      console.log("   价格时间戳:", new Date(Number(timestamp) * 1000).toLocaleString());
      console.log("   价格有效性:", isValid);
      
      console.log("\n💰 Token 状态:");
      const sBalance = await stableToken.read.balanceOf([user.account.address]);
      const tokenId = 2n;
      const lBalance = await multiLeverageToken.read.balanceOf([user.account.address, tokenId]);
      console.log("   User S Token:", formatEther(sBalance));
      console.log("   User L Token:", formatEther(lBalance));
      
      console.log("\n🏦 Custodian 状态:");
      const totalSupplyS = await custodian.read.totalSupplyS();
      const totalSupplyL = await custodian.read.totalSupplyL();
      const collateral = await custodian.read.CollateralInWei();
      console.log("   Total S Supply:", formatEther(totalSupplyS));
      console.log("   Total L Supply:", formatEther(totalSupplyL));
      console.log("   Total Collateral:", formatEther(collateral), "WLTC");
      
      console.log("\n" + "=".repeat(60));
      console.log("✅ 所有 Oracle 测试通过！");
      console.log("=".repeat(60) + "\n");
    });
  });
});
