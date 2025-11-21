import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { network } from "hardhat";
import { formatEther, parseEther } from "viem";

/**
 * 测试目标：
 * 1) 部署自建 oracle (LTCPriceOracle) 与 API3 适配 oracle (LTCPriceOracleApi)，验证都能返回价格
 * 2) 在 CustodianFixed 中调用 updatePriceFeed 切换 oracle，验证价格读取成功
 *
 * 运行命令：npx hardhat test test/OracleApi.test.ts
 */

describe("Oracle Adapter (API3) & PriceFeed Update", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  const API3_PROXY_ONCHAIN = "0x1A4d44BE0f37bD39b191A8829F46f56737C68D9D";

  // 基础合约
  let wltc: any;
  let stableToken: any;
  let lToken: any;
  let interestManager: any;
  let custodian: any;

  // Oracles
  let ltcOracle: any;              // 自建 oracle (IChainlinkV3)
  let api3Proxy: any;              // API3 代理（若本地无则使用 mock）
  let ltcOracleApiAdapter: any;    // 适配器 (LTCPriceOracleApi)

  before(async () => {
    // 部署基础组件
    wltc = await viem.deployContract("WLTCMock", []);
    stableToken = await viem.deployContract("StableToken", []);
    lToken = await viem.deployContract("MultiLeverageToken", ["https://api.example.com/metadata/"]);
    interestManager = await viem.deployContract("InterestManager", [wltc.address, 300n]);

    // 部署自建 oracle，初始价格 120 USD (18位)
    const INITIAL_PRICE = parseEther("120");
    ltcOracle = await viem.deployContract("LTCPriceOracle", [INITIAL_PRICE, []]);

    // 部署 Custodian 并初始化
    custodian = await viem.deployContract("CustodianFixed", [
      wltc.address,
      stableToken.address,
      lToken.address,
    ]);

    await interestManager.write.initialize([lToken.address, custodian.address]);
    await stableToken.write.setCustodian([custodian.address]);
    await lToken.write.setCustodian([custodian.address]);
    await custodian.write.initialize([interestManager.address, ltcOracle.address]);

    // 尝试使用提供的 API3 代理地址；若本地网络无代码，则部署 Mock 替代
    const bytecode = await publicClient.getBytecode({ address: API3_PROXY_ONCHAIN as `0x${string}` }).catch(() => undefined);
    if (!bytecode) {
      // 本地链上没有该地址合约，部署一个 Mock：read() -> (value, timestamp)
      const now = Math.floor(Date.now() / 1000);
      // 适配器按 18 位返回；这里直接给 150 USD (18位) 的数值
      // IApi3ReaderProxy.read 返回 int224，timestamp uint32
      // 这里 value 直接给 150e18
        api3Proxy = await viem.deployContract("Api3ReaderProxyMock", [
        150000000000000000000n, // 150e18 as int224
        now,
      ]);
    } else {
      // 直接使用链上代理
      api3Proxy = { address: API3_PROXY_ONCHAIN } as any;
    }

    // 部署适配器，构造参数为 API3 proxy 地址
    ltcOracleApiAdapter = await viem.deployContract("LTCPriceOracleApi", [api3Proxy.address]);
  });

  it("两种 oracle 都能返回价格: 自建与 API3 适配器", async () => {
    // 自建 oracle 通过 custodian 读取
    const [price1, ts1, ok1] = await custodian.read.getLatestPriceView();
    assert.strictEqual(ok1, true);
    assert.ok(price1 > 0n);

    // 直接读取适配器的 latestRoundData（IChainlinkV3 形态）
    const [roundId, answer, startedAt, updatedAt, answeredInRound] =
      await ltcOracleApiAdapter.read.latestRoundData();

    assert.ok(answer > 0n);
    assert.ok(updatedAt > 0n);
    assert.ok(roundId > 0n && answeredInRound >= roundId);

    console.log("自建 Oracle 价格(18位):", formatEther(price1));
    console.log("API3 适配器价格(18位):", formatEther(answer));
  });

  it("updatePriceFeed: 将 Custodian 切换到 API3 适配器并读取价格", async () => {
    // 切换 priceFeed -> ltcOracleApiAdapter
    const hash = await custodian.write.updatePriceFeed([ltcOracleApiAdapter.address]);
    await publicClient.waitForTransactionReceipt({ hash });

    // 验证地址与精度
    const pf = await custodian.read.priceFeed();
    const decimals = await custodian.read.priceFeedDecimals();
    assert.strictEqual(pf.toLowerCase(), ltcOracleApiAdapter.address.toLowerCase());
    assert.strictEqual(decimals, 18);

    // 读取价格
    const [price2, ts2, ok2] = await custodian.read.getLatestPriceView();
    assert.strictEqual(ok2, true);
    assert.ok(price2 > 0n);
    console.log("切换后 Custodian 读取价格(18位):", formatEther(price2));
  });
});
