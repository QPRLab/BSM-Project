// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainlinkV3.sol";
import "@api3/contracts/interfaces/IApi3ReaderProxy.sol";

/**
 * @title LTCPriceOracleApi
 * @dev 將 API3 的 IApi3ReaderProxy 讀取結果適配為 Chainlink V3 Aggregator 風格接口 (IChainlinkV3)。
 *      方便現有依賴（如 CustodianFixed、其他使用 IChainlinkV3 的合約）無縫使用 API3 的數據。
 *
 * 設計說明:
 * - API3 read() -> (int224 value, uint32 timestamp)
 * - Chainlink latestRoundData() -> (roundId, answer, startedAt, updatedAt, answeredInRound)
 * - 我們將 timestamp 作為 startedAt/updatedAt，roundId 由遞增計數器給出（若讀取到新時間戳則自增）。
 * - answer 以 int256(value) 返回，假定 API3 feed 使用 18 位精度（可擴展）。
 * - 添加最大允許陳舊時間 (MAX_STALENESS) 限制，避免使用過期價格。
 */
contract LTCPriceOracleApi is IChainlinkV3, Ownable {
    IApi3ReaderProxy public proxy;            // API3 LTC/USD Feed Proxy
    uint8 public constant override decimals = 18; // 對外聲明與原生 LTCPriceOracle 相同精度
    uint256 public constant MAX_STALENESS = 3600; // 最長允許數據陳舊時間（秒）

    // 內部輪次控制（僅為符合 Chainlink roundId 結構，方便下游統一處理）
    uint80 public lastRoundId;
    uint32 public lastTimestamp; // 上次已記錄的時間戳

    event ProxyUpdated(address indexed previous, address indexed current);

    constructor(address _proxy) Ownable(msg.sender) {
        require(_proxy != address(0), "Invalid proxy");
        proxy = IApi3ReaderProxy(_proxy);
        // 初始化第一輪
        lastRoundId = 1;
        (, uint32 ts) = proxy.read();
        lastTimestamp = ts;
        emit ProxyUpdated(address(0), _proxy);
    }

    function updateProxy(address _newProxy) external onlyOwner {
        require(_newProxy != address(0), "Invalid proxy");
        address previous = address(proxy);
        require(previous != _newProxy, "Same proxy");
        // 基本可用性檢查
        IApi3ReaderProxy candidate = IApi3ReaderProxy(_newProxy);
        // 嘗試讀取，確保兼容
        try candidate.read() returns (int224 value, uint32 ts) {
            require(value > 0, "Invalid value");
            require(ts <= block.timestamp, "Future ts");
        } catch {
            revert("Proxy incompatible");
        }
        proxy = candidate;
        // 重置輪次（可選：保留原輪次避免下游混淆，這裡選擇自增）
        lastRoundId++;
        (, uint32 nts) = proxy.read();
        lastTimestamp = nts;
        emit ProxyUpdated(previous, _newProxy);
    }

    // IChainlinkV3 接口實現
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        (int224 rawValue, uint32 ts) = proxy.read();
        require(rawValue > 0, "Negative/zero price");
        require(ts > 0 && ts <= block.timestamp, "Bad timestamp");
        require(block.timestamp - ts <= MAX_STALENESS, "Stale price");

        // 合成輪次：如果本次讀取時間戳與記錄不同，視為新輪次（僅在 view 中動態計算，不改狀態）
        uint80 syntheticRoundId = lastRoundId;
        if (ts != lastTimestamp) {
            // 不修改狀態 (view)，僅返回遞增後的虛擬輪次值
            syntheticRoundId = lastRoundId + 1;
        }

        return (
            syntheticRoundId,
            int256(rawValue),
            uint256(ts),
            uint256(ts),
            syntheticRoundId
        );
    }
}
