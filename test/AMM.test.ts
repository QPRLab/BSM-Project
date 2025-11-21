import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatUnits } from "viem";

/*
 * 命令：npx hardhat test test/AMMLiquidity.ts   
*/

describe("AMM - basic flows", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const walletClients = await viem.getWalletClients();
  const feeders = walletClients.slice(0, 4).map(client => client.account.address);
  const deployer = walletClients[0].account.address;// Hardhat 测试网络中的第一个预定义测试账户地址。
  const feeCollector = deployer;

  let wltc: any, usdc: any, stable: any, leverage: any;
  let interestManager: any, ltcOracle: any, custodian: any;
  let ammliquidity: any, ammswap: any;

  before(async function () {

    console.log("deployer address:", deployer);
  
    // 1. 合约部署(将合约部署到 Hardhat 的本地测试网络（Hardhat Network），这是一个运行在您本地机器上的以太坊模拟器。)
    wltc = await viem.deployContract("WLTCMock");
    usdc = await viem.deployContract("USDCMock");
    stable = await viem.deployContract("StableToken");
    leverage = await viem.deployContract("MultiLeverageToken",["ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/"]);
    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);
    const initialPrice = 120n * 10n ** 18n;
    ltcOracle = await viem.deployContract("LTCPriceOracle", [initialPrice, feeders]);
    custodian = await viem.deployContract("CustodianFixed", [wltc.address, stable.address, leverage.address]);


    //2. 相关初始化及设置
    const initializeInterestManagerCall = await interestManager.write.initialize([leverage.address, custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: initializeInterestManagerCall });
    const setStableCustodianCall = await stable.write.setCustodian([custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: setStableCustodianCall });
    const setLeverageCustodianCall = await leverage.write.setCustodian([custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: setLeverageCustodianCall });
    const CustodianInitializeCall = await custodian.write.initialize([interestManager.address, ltcOracle.address]);
    await publicClient.waitForTransactionReceipt({ hash: CustodianInitializeCall });

    //3. 部署amm
    ammliquidity = await viem.deployContract("AMMLiquidity", [stable.address, usdc.address, "LP Token", "LPT"]);
    ammswap = await viem.deployContract("AMMSwap", [
      wltc.address, // underlyingToken
      usdc.address, // usdcToken
      stable.address, // stableToken
      leverage.address, // multiLeverageToken
      "0x0000000000000000000000000000000000000000", // dexRouter (disabled)
      "0x0000000000000000000000000000000000000000", // quoter (disabled)
      "0x0000000000000000000000000000000000000000", // usdcUnderlyingPool (disabled)
      3000 // poolFee
    ]);
    const ammliquidityInitializeCall = await ammliquidity.write.initialize([ammswap.address, feeCollector]);
    await publicClient.waitForTransactionReceipt({ hash: ammliquidityInitializeCall });
    const ammSwapInitializeCall = await ammswap.write.initialize([custodian.address, ammliquidity.address]);
    await publicClient.waitForTransactionReceipt({ hash: ammSwapInitializeCall });

  });

  it("mint WLTC and USDC", async function () {
    const mintWltcAmount = 10000n * 10n ** 18n;
    const mintUsdcAmount = 1200000n * 10n ** 6n;

    // 获取铸币前的余额
    const wltcBalanceBefore = await wltc.read.balanceOf([deployer]);
    const usdcBalanceBefore = await usdc.read.balanceOf([deployer]);

    const tx1 = await wltc.write.mint([deployer, mintWltcAmount]);
    await publicClient.waitForTransactionReceipt({ hash: tx1 });

    const tx2 = await usdc.write.mint([deployer, mintUsdcAmount]);
    await publicClient.waitForTransactionReceipt({ hash: tx2 });

    // 检查余额是否正确增加
    const wltcBalanceAfter = await wltc.read.balanceOf([deployer]);
    const usdcBalanceAfter = await usdc.read.balanceOf([deployer]);

    assert.equal(wltcBalanceAfter, wltcBalanceBefore + mintWltcAmount, "WLTC balance should increase by mint amount");
    assert.equal(usdcBalanceAfter, usdcBalanceBefore + mintUsdcAmount, "USDC balance should increase by mint amount");

  });

  it("call custodian to mint stable and leverage", async function () {
    const underlyingAmount = 1000n * 10n ** 18n;
    const mintPrice = 120n * 10n ** 18n;
    // approve underlying to custodian
    const approveTx = await wltc.write.approve([custodian.address, underlyingAmount]);
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    //函数名：function mint(uint256 underlyingAmountInWei, uint256 mintPriceInWei, LeverageType leverageLevel)
    const tx1 = await custodian.write.mint([underlyingAmount, mintPrice, 2n]);//2x: 1S1L
    await publicClient.waitForTransactionReceipt({ hash: tx1 });


    //check stable and leverage balance
    const stableBalance = await stable.read.balanceOf([deployer]);
    const trueStableBalance = 60000n * 10n ** 18n;
    assert.equal(stableBalance, trueStableBalance, "Stable balance should be 60000 * 10^18");

    //check leverage balance
    const trueLeverageBalance = 60000n * 10n ** 18n;
    const leverageTokenInfo = await custodian.read.getAllLeverageTokenInfo([deployer]);
    // console.log("Leverage Token Info:", leverageTokenInfo);
    assert.equal(leverageTokenInfo[0][0], 2n, "tokenId should be 2");//注意：token id从1开始
    assert.equal(leverageTokenInfo[1][0], trueLeverageBalance, "balance should be 60000 * 10^18");

  });

  it("approve for AMM", async function () {
    // mint some stable (18 decimals) and usdc (6 decimals) to deployer
    const stableAmount = 50000n * 10n ** 18n;
    const usdcAmount = 50000n * 10n ** 6n;

    // approve AMM to pull tokens
    const tx4 = await stable.write.approve([ammliquidity.address, stableAmount]);
    const tx5 = await usdc.write.approve([ammliquidity.address, usdcAmount]);
    await publicClient.waitForTransactionReceipt({ hash: tx4 });
    await publicClient.waitForTransactionReceipt({ hash: tx5 });
  });

  it("initial reserves should be zero", async function () {
    const initialReserves = await ammliquidity.read.getReserves();
    assert.equal(initialReserves[0], 0n);
    assert.equal(initialReserves[1], 0n);
  });

  it("add liquidity by supplying Stable", async function () {
    const addStableAmount = 10000n * 10n ** 18n; // 10000 stable
    const usdcAmount = 10000n * 10n ** 6n;
    const txAdd = await ammliquidity.write.addLiquidityStable([addStableAmount]);
    await publicClient.waitForTransactionReceipt({ hash: txAdd });

    //check reserves
    const reservesAfter = await ammliquidity.read.getReserves();
    assert.equal(reservesAfter[0], addStableAmount, "Stable reserve should match added amount");
    assert.equal(reservesAfter[1], usdcAmount, "USDC reserve should match added amount");

    //check lp token balance
    const lpTokenAddr = await ammliquidity.read.lpToken();
    const lp = await viem.getContractAt("LPToken", lpTokenAddr);
    const lpBal = await lp.read.balanceOf([deployer]);
    const truelpBal = 20000n * 10n ** 18n - 1000n; // 减去锁定的最小流动性
    assert.equal(lpBal, truelpBal, "LP balance should match expected amount after adding liquidity");

  });

  it("add liquidity by supplying USDC", async function () {


    //check reserves before
    const reservesBefore = await ammliquidity.read.getReserves();
    const lpTokenAddr = await ammliquidity.read.lpToken();
    const lp = await viem.getContractAt("LPToken", lpTokenAddr);
    const lpTotalSupplyBefore = await lp.read.totalSupply();
    const lpBalBefore = await lp.read.balanceOf([deployer]);

    // add liquidity by usdc
    const addUsdcAmount = 10000n * 10n ** 6n; // 10000 USDC
    const stableAmount = 10000n * 10n ** 18n;
    const txAdd = await ammliquidity.write.addLiquidityUSDC([addUsdcAmount]);
    await publicClient.waitForTransactionReceipt({ hash: txAdd });
    const lpTotalSupplyAfter = await lp.read.totalSupply();
    const lpBalAfter = await lp.read.balanceOf([deployer]);

    //check lp token balance
    const expectedLpMinted = (lpTotalSupplyBefore * addUsdcAmount) / reservesBefore[1];
    assert.equal(lpTotalSupplyAfter - lpTotalSupplyBefore, expectedLpMinted, "LP total supply should increase by expected amount");
    assert.equal(lpBalAfter - lpBalBefore, expectedLpMinted, "LP balance should increase by expected amount");

    //check reserves after
    const reservesAfter = await ammliquidity.read.getReserves();
    assert.equal(reservesAfter[0], stableAmount + reservesBefore[0], "Stable reserve should match added amount");
    assert.equal(reservesAfter[1], addUsdcAmount + reservesBefore[1], "USDC reserve should match added amount");

  });


  it("remove liquidity", async function () {
    
    //check reserves before
    const reservesBefore = await ammliquidity.read.getReserves();
    const lpTokenAddr = await ammliquidity.read.lpToken();
    const lp = await viem.getContractAt("LPToken", lpTokenAddr);
    const lpTotalSupplyBefore = await lp.read.totalSupply();
    const lpBalBefore = await lp.read.balanceOf([deployer]);

    //remove 1/5 of lp balance
    const lpToRemove = lpBalBefore / 5n;
    const txRem = await ammliquidity.write.removeLiquidity([lpToRemove]);
    await publicClient.waitForTransactionReceipt({ hash: txRem });
    const lpTotalSupplyAfter = await lp.read.totalSupply();
    const lpBalAfter = await lp.read.balanceOf([deployer]);

    //check lp token balance
    assert.equal(lpBalBefore - lpBalAfter, lpToRemove, "LP balance should decrease by expected amount");

    //check reserves after
    const reservesAfter = await ammliquidity.read.getReserves();
    assert.equal(reservesAfter[0], reservesBefore[0] - lpToRemove * reservesBefore[0] / lpTotalSupplyBefore, "Stable reserve should match removed amount");
    assert.equal(reservesAfter[1], reservesBefore[1] - lpToRemove * reservesBefore[1] / lpTotalSupplyBefore, "USDC reserve should match removed amount");
  });


  it("test sell stable token in AMMSwap", async function () {
    const stableAmount = 100n * 10n ** 18n;

    //check ammliquidity reserves before
    const reservesBefore = await ammliquidity.read.getReserves();
    // console.log("AMMLiquidity Reserves before swap:", reservesBefore);

    // get balance before
    const usdcBalanceBefore = await usdc.read.balanceOf([deployer]);

    // approve stable to ammliquidity
    await stable.write.approve([ammliquidity.address, stableAmount]);

    // preview
    const preview = await ammswap.read.previewSwapStableToUsdc([stableAmount]);
    // console.log("Preview:", preview);

    const usdcAmount = await ammswap.read.swapStableToUsdc([stableAmount]);//只有read才会返回函数返回值
    console.log("Stable Amount Spent:", formatUnits(stableAmount, 18));
    console.log("USDC Amount Get:", formatUnits(usdcAmount, 6));

    const hx = await ammswap.write.swapStableToUsdc([stableAmount]);
    await publicClient.waitForTransactionReceipt({ hash: hx });

    const usdcBalanceAfter = await usdc.read.balanceOf([deployer]);
    const usdcReceived = usdcBalanceAfter - usdcBalanceBefore;
    assert.ok(usdcReceived > 0n, "USDC amount should be greater than zero");
  });

  it("test buy stable token in AMMSwap", async function () {
    const usdcAmount = 100n * 10n ** 6n;

    //check ammliquidity reserves before
    const reservesBefore = await ammliquidity.read.getReserves();
    // console.log("AMMLiquidity Reserves before swap:", reservesBefore);

    // get balance before
    const stableBalanceBefore = await stable.read.balanceOf([deployer]);

    // approve usdc to ammliquidity
    await usdc.write.approve([ammliquidity.address, usdcAmount]);

    // preview
    const preview = await ammswap.read.previewSwapUsdcToStable([usdcAmount]);
    // console.log("Preview:", preview);

    const stableAmount = await ammswap.read.swapUsdcToStable([usdcAmount]);
    console.log("USDC Amount Spent:", formatUnits(usdcAmount, 6));
    console.log("Stable Amount Get:", formatUnits(stableAmount, 18));

    const hx = await ammswap.write.swapUsdcToStable([usdcAmount]);
    await publicClient.waitForTransactionReceipt({ hash: hx });

    const stableBalanceAfter = await stable.read.balanceOf([deployer]);
    const stableReceived = stableBalanceAfter - stableBalanceBefore;
    // console.log("Stable received:", stableReceived);
    assert.ok(stableReceived > 0n, "Stable amount should be greater than zero");
  });

});
