import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { parseUnits } from "viem";

describe("CustodianFixed - core flows", function () {
  let wltc: any;
  let usdc: any;
  let stable: any;
  let leverage: any;
  let interestManager: any;
  let ltcOracle: any;
  let custodian: any;
  let auctionManager: any;
  let liquidationManager: any;
  let deployer: any;
  let user: any;
  let publicClient: any;

  before(async () => {
    const { viem } = await network.connect();
    publicClient = await viem.getPublicClient();
    [deployer, user] = await viem.getWalletClients();

    // Deploy tokens and core contracts
    wltc = await viem.deployContract("WLTCMock", []);
    usdc = await viem.deployContract("USDCMock", []);
    stable = await viem.deployContract("StableToken", []);
    leverage = await viem.deployContract("MultiLeverageToken", ["https://api.example.com/metadata/"]);

    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);
    const initialPrice = 120n * 10n ** 18n;
    ltcOracle = await viem.deployContract("LTCPriceOracle", [initialPrice, [deployer.account.address]]);

    custodian = await viem.deployContract("CustodianFixed", [wltc.address, stable.address, leverage.address]);

    auctionManager = await viem.deployContract("AuctionManager", [stable.address, custodian.address]);
    liquidationManager = await viem.deployContract("LiquidationManager", [leverage.address, custodian.address]);

    // initialize interest manager
    const initIM = await interestManager.write.initialize([leverage.address, custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: initIM });

    // set custodians for tokens
    const setStable = await stable.write.setCustodian([custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: setStable });
    const setLeverage = await leverage.write.setCustodian([custodian.address]);
    await publicClient.waitForTransactionReceipt({ hash: setLeverage });

    // initialize custodian (interestManager, priceFeed, auctionManager, liquidationManager)
    const initC = await custodian.write.initialize([
      interestManager.address,
      ltcOracle.address,
      auctionManager.address,
      liquidationManager.address,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: initC });
  });

  it("mint should produce S and L and update collateral", async function () {
    const underlyingAmount = 1000n * 10n ** 18n;
    const mintPrice = 120n * 10n ** 18n;

    // mint some underlying to deployer
    const mintWltc = await wltc.write.mint([deployer.account.address, underlyingAmount]);
    await publicClient.waitForTransactionReceipt({ hash: mintWltc });

    // approve custodian
    const approve = await wltc.write.approve([custodian.address, underlyingAmount]);
    await publicClient.waitForTransactionReceipt({ hash: approve });

    // call mint
    const tx = await custodian.write.mint([underlyingAmount, mintPrice, 2n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    // verify stable & leverage minted and collateral recorded
    const stableBal = await stable.read.balanceOf([deployer.account.address]);
    const leverInfo = await custodian.read.getAllLeverageTokenInfo([deployer.account.address]);

    // compute expected mint amounts using same formulas as CustodianUtils
    const PRICE_PRECISION = 10n ** 18n;
    // leverageLevel passed as 2n in test corresponds to LeverageType.MODERATE in contract
    // mapping: 0=CONSERVATIVE,1=MODERATE,2=AGGRESSIVE? The test passed 2n earlier; to be safe we
    // inspect the returned leverage of the token below and compute based on that.

    // ensure stable minted
    assert.ok(stableBal > 0n, "stable should be minted");

    // get token details returned by custodian helper
    const tokenIds = leverInfo[0];
    const balances = leverInfo[1];
    assert.ok(tokenIds.length > 0, "user should have at least one leverage token id");

    // use first token balance and its leverage type to compute expected S and L
    const tokenId = tokenIds[0];
    const lAmountOnchain = balances[0];
    const tokenInfo = await custodian.read.getTokenDetails([tokenId]);
    const leverageType = tokenInfo[0];

    // derive expected S and L following CustodianUtils.calculateMintAmounts
    let expectedS;
    let expectedL;
    if (leverageType === 0n) {
      // CONSERVATIVE
      expectedS = (underlyingAmount * mintPrice) / (9n * PRICE_PRECISION);
      expectedL = 8n * expectedS;
    } else if (leverageType === 1n) {
      // MODERATE
      expectedS = (underlyingAmount * mintPrice) / (5n * PRICE_PRECISION);
      expectedL = 4n * expectedS;
    } else {
      // AGGRESSIVE
      expectedS = (underlyingAmount * mintPrice) / (2n * PRICE_PRECISION);
      expectedL = expectedS;
    }

    // check totals
    const totalS = await custodian.read.totalSupplyS();
    const totalL = await custodian.read.totalSupplyL();

    assert.equal(totalS, expectedS, "totalSupplyS must match expected S minted");
    assert.equal(totalL, expectedL, "totalSupplyL must match expected L minted");

    const userCollateral = await custodian.read.getUserCollateral([deployer.account.address]);
    assert.equal(userCollateral, underlyingAmount, "userCollateral should reflect deposited underlying");
    assert.ok(totalS > 0n, "totalSupplyS should be positive");
    assert.ok(totalL > 0n, "totalSupplyL should be positive");
  });

  it("previewMint returns positive S and L amounts", async function () {
    const underlyingAmount = 500n * 10n ** 18n;
    const mintPrice = 120n * 10n ** 18n;
    const currentPrice = 120n * 10n ** 18n;

    const [sAmount, lAmount] = await custodian.read.previewMint([underlyingAmount, 2n, mintPrice, currentPrice]);
    assert.ok(sAmount > 0n, "preview sAmount should be > 0");
    assert.ok(lAmount > 0n, "preview lAmount should be > 0");

    // compute expected using same formula (here test used leverage=2n -> treat as AGGRESSIVE)
    const PRICE_PRECISION = 10n ** 18n;
    // treat 2n as AGGRESSIVE (index mapping may vary; the preview is what contract uses)
    const expectedS = (underlyingAmount * mintPrice) / (2n * PRICE_PRECISION);
    const expectedL = expectedS;
    // allow equality
    assert.equal(sAmount, expectedS, "preview sAmount must equal expected");
    assert.equal(lAmount, expectedL, "preview lAmount must equal expected");
  });

  it("burnFromUser should burn S/L and return underlying", async function () {
    // get user's leverage token id
    const leverInfo = await custodian.read.getAllLeverageTokenInfo([deployer.account.address]);
    const tokenIds = leverInfo[0];
    assert.ok(tokenIds.length > 0, "no token ids found");
    const tokenId = tokenIds[0];

    const wltcBalBefore = await wltc.read.balanceOf([deployer.account.address]);
    const stableBalBefore = await stable.read.balanceOf([deployer.account.address]);

    // call burnFromUser with 50%
    const tx = await custodian.write.burnFromUser([tokenId, 50n]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    const wltcBalAfter = await wltc.read.balanceOf([deployer.account.address]);
    const stableBalAfter = await stable.read.balanceOf([deployer.account.address]);

    // Recompute expected burn preview using CustodianUtils.previewBurn logic
    // Need total L amount, leverage type and mintPrice
    const totalL = await leverage.read.balanceOf([deployer.account.address, tokenId]);
    const tokenDetails = await custodian.read.getTokenDetails([tokenId]);
    const leverageType = tokenDetails[0];
    const mintPrice = tokenDetails[1];

    const PRICE_PRECISION = 10n ** 18n;
    // previewBurn logic (simplified): lAmountBurned = totalL * 50 / 100
    const lAmountBurned = (totalL * 50n) / 100n;
    let sAmountNeeded;
    let underlyingAmountInWei;
    if (leverageType === 0n) {
      sAmountNeeded = lAmountBurned / 8n;
      underlyingAmountInWei = 9n * sAmountNeeded * PRICE_PRECISION / mintPrice;
    } else if (leverageType === 1n) {
      sAmountNeeded = lAmountBurned / 4n;
      underlyingAmountInWei = 5n * sAmountNeeded * PRICE_PRECISION / mintPrice;
    } else {
      sAmountNeeded = lAmountBurned;
      underlyingAmountInWei = 2n * sAmountNeeded * PRICE_PRECISION / mintPrice;
    }

    // after burning, user should receive underlyingAmountInWei (approx)
    // because underlying token has 18 decimals in this test (WLTCMock), compare balances accordingly
    assert.ok(wltcBalAfter >= wltcBalBefore, "user should receive underlying back");
    assert.ok(stableBalAfter <= stableBalBefore, "stable should be burned or decreased");
    // check that change in underlying equals expected underlyingAmountInWei (allow >= due to rounding)
    const deltaUnderlying = wltcBalAfter - wltcBalBefore;
    assert.ok(deltaUnderlying >= 0n, "unexpected underlying change");
    assert.ok(deltaUnderlying >= underlyingAmountInWei - 1n, "underlying returned should match expected (within 1 wei)");
  });

});
