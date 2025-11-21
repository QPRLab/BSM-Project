// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title QuoterV2Mock
 * @notice Mock implementation of Uniswap V3 QuoterV2 for testing
 * @dev 模拟 QuoterV2 的报价功能，用于本地测试
 */
contract QuoterV2Mock {
    // 模拟价格：1 WLTC = 120 USDC
    uint256 public constant MOCK_PRICE = 120 * 10**6; // 120 USDC (6 decimals)
    uint256 public constant PRICE_PRECISION = 10**18; // WLTC has 18 decimals

    // 模拟滑点 (0.5%)
    uint256 public constant SLIPPAGE = 50; // 0.5% in basis points

    address public immutable wltc;
    address public immutable usdc;

    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountOut;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    constructor(address _wltc, address _usdc) {
        require(_wltc != address(0), "Invalid WLTC address");
        require(_usdc != address(0), "Invalid USDC address");
        wltc = _wltc;
        usdc = _usdc;
    }

    /**
     * @notice 模拟 QuoterV2 的 quoteExactInputSingle
     * @param params 报价参数
     * @return amountOut 输出数量
     * @return sqrtPriceX96After 交易后的价格（模拟值）
     * @return initializedTicksCrossed 跨越的tick数（模拟值）
     * @return gasEstimate gas估算（模拟值）
     */
    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        view
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        require(params.amountIn > 0, "Invalid amount");

        // 计算输出量
        if (params.tokenIn == wltc && params.tokenOut == usdc) {
            // WLTC -> USDC
            amountOut = (params.amountIn * MOCK_PRICE) / PRICE_PRECISION;
            amountOut = (amountOut * (10000 - SLIPPAGE)) / 10000;
        } else if (params.tokenIn == usdc && params.tokenOut == wltc) {
            // USDC -> WLTC
            amountOut = (params.amountIn * PRICE_PRECISION) / MOCK_PRICE;
            amountOut = (amountOut * (10000 - SLIPPAGE)) / 10000;
        } else {
            revert("Unsupported token pair");
        }

        // 模拟返回值
        sqrtPriceX96After = 1000000000000000000; // 模拟价格
        initializedTicksCrossed = 5; // 模拟跨越5个tick
        gasEstimate = 80000; // 模拟gas消耗
    }

    /**
     * @notice 模拟 QuoterV2 的 quoteExactOutputSingle
     * @param params 报价参数
     * @return amountIn 输入数量
     * @return sqrtPriceX96After 交易后的价格（模拟值）
     * @return initializedTicksCrossed 跨越的tick数（模拟值）
     * @return gasEstimate gas估算（模拟值）
     */
    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params)
        external
        view
        returns (
            uint256 amountIn,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        )
    {
        require(params.amountOut > 0, "Invalid amount");

        // 计算输入量（不包含滑点，滑点由调用者处理）
        if (params.tokenIn == usdc && params.tokenOut == wltc) {
            // USDC -> WLTC (buying WLTC)
            amountIn = (params.amountOut * MOCK_PRICE) / PRICE_PRECISION;
            // 不再添加滑点：amountIn = (amountIn * (10000 + SLIPPAGE)) / 10000;
        } else if (params.tokenIn == wltc && params.tokenOut == usdc) {
            // WLTC -> USDC (selling WLTC)
            amountIn = (params.amountOut * PRICE_PRECISION) / MOCK_PRICE;
            // 不再添加滑点：amountIn = (amountIn * (10000 + SLIPPAGE)) / 10000;
        } else {
            revert("Unsupported token pair");
        }

        // 模拟返回值
        sqrtPriceX96After = 1000000000000000000; // 模拟价格
        initializedTicksCrossed = 5; // 模拟跨越5个tick
        gasEstimate = 80000; // 模拟gas消耗
    }

    /**
     * @dev 更新模拟价格（可选功能，用于测试不同价格场景）
     */
    function getMockPrice() external pure returns (uint256) {
        return MOCK_PRICE;
    }
}
