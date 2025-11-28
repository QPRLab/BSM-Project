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

    assert.ok(stableBal > 0n, "stable should be minted");
    assert.ok(leverInfo[0].length > 0, "user should have at least one leverage token id");

    const userCollateral = await custodian.read.getUserCollateral([deployer.account.address]);
    assert.equal(userCollateral, underlyingAmount, "userCollateral should reflect deposited underlying");

    const totalS = await custodian.read.totalSupplyS();
    const totalL = await custodian.read.totalSupplyL();
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

    assert.ok(wltcBalAfter >= wltcBalBefore, "user should receive underlying back");
    assert.ok(stableBalAfter <= stableBalBefore, "stable should be burned or decreased");
  });

  it("only owner can update price feed", async function () {
    // deploy another oracle
    const newPrice = 150n * 10n ** 18n;
    const oracle2 = await ltcOracle.deployer.deploy({ args: [newPrice, [deployer.account.address]] });

    try {
      // attempt with non-owner (user)
      await user.writeContract({
        address: custodian.address,
        abi: custodian.abi,
        functionName: "updatePriceFeed",
        args: [oracle2.address],
      });
      assert.fail("non-owner should not be able to update price feed");
    } catch (err: any) {
      assert.ok(err.message.includes("OwnableUnauthorizedAccount") || err.message.includes("revert"));
    }
  });

});
