// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/IERC20.sol";

/**
 * @title UniversalRouterMock
 * @notice Mock implementation of Uniswap V3 UniversalRouter for testing
 * @dev 模拟 UniversalRouter 的基本功能，用于本地测试
 */
contract UniversalRouterMock {
    // V3 Swap Commands
    bytes1 public constant V3_SWAP_EXACT_IN = 0x00;
    bytes1 public constant V3_SWAP_EXACT_OUT = 0x01;

    // 模拟价格：1 WLTC = 120 USDC
    uint256 public constant MOCK_PRICE = 120 * 10**6; // 120 USDC (6 decimals)
    uint256 public constant PRICE_PRECISION = 10**18; // WLTC has 18 decimals

    // 滑点容忍度 (0.5%)
    uint256 public constant SLIPPAGE = 50; // 0.5% in basis points

    IERC20 public immutable wltc;
    IERC20 public immutable usdc;

    event SwapExecuted(
        bytes1 command,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    constructor(address _wltc, address _usdc) {
        require(_wltc != address(0), "Invalid WLTC address");
        require(_usdc != address(0), "Invalid USDC address");
        wltc = IERC20(_wltc);
        usdc = IERC20(_usdc);
    }

    /**
     * @notice 模拟 UniversalRouter 的 execute 函数
     * @param commands 交易命令
     * @param inputs 编码的参数数组
     * @param deadline 过期时间
     */
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "Transaction expired");
        require(commands.length > 0, "No commands");
        require(inputs.length > 0, "No inputs");

        bytes1 command = commands[0];

        if (command == V3_SWAP_EXACT_IN) {
            _executeExactInput(inputs[0]);
        } else if (command == V3_SWAP_EXACT_OUT) {
            _executeExactOutput(inputs[0]);
        } else {
            revert("Unsupported command");
        }
    }

    /**
     * @dev 执行精确输入交易 (V3_SWAP_EXACT_IN)
     * 参数: (address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser)
     */
    function _executeExactInput(bytes calldata input) internal {
        (
            address recipient,
            uint256 amountIn,
            uint256 amountOutMin,
            bytes memory path,
            bool payerIsUser
        ) = abi.decode(input, (address, uint256, uint256, bytes, bool));

        // 解析 path: tokenIn, fee, tokenOut
        (address tokenIn, , address tokenOut) = _decodePath(path);

        // 计算输出量
        uint256 amountOut = _calculateAmountOut(tokenIn, tokenOut, amountIn);
        require(amountOut >= amountOutMin, "Insufficient output amount");

        // ⚠️ 修复：正确模拟 payerIsUser 行为
        // payerIsUser=true: 从 msg.sender（调用者）拉取代币
        // payerIsUser=false: 从合约自己的余额中取代币（调用者应该已经预先转账了）
        if (payerIsUser) {
            // 从调用者拉取
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        } else {
            // 使用合约自己的余额（调用者应该已经转账了）
            require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, "Insufficient tokenIn in router");
        }
        
        // 输出代币给 recipient
        IERC20(tokenOut).transfer(recipient, amountOut);

        emit SwapExecuted(V3_SWAP_EXACT_IN, tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    /**
     * @dev 执行精确输出交易 (V3_SWAP_EXACT_OUT)
     * 参数: (address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser)
     */
    function _executeExactOutput(bytes calldata input) internal {
        (
            address recipient,
            uint256 amountOut,
            uint256 amountInMax,
            bytes memory path,
            bool payerIsUser
        ) = abi.decode(input, (address, uint256, uint256, bytes, bool));

        // 解析 path: tokenIn, fee, tokenOut
        (address tokenIn, , address tokenOut) = _decodePath(path);

        // 计算输入量
        uint256 amountIn = _calculateAmountIn(tokenIn, tokenOut, amountOut);
        require(amountIn <= amountInMax, "Excessive input amount");

        // ⚠️ 修复：正确模拟 payerIsUser 行为
        // payerIsUser=true: 从 msg.sender（调用者）拉取代币
        // payerIsUser=false: 从合约自己的余额中取代币
        if (payerIsUser) {
            // 从调用者拉取
            IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        } else {
            // 使用合约自己的余额
            require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn, "Insufficient tokenIn in router");
        }
        
        // 输出代币给 recipient
        IERC20(tokenOut).transfer(recipient, amountOut);
        
        // 如果使用的输入少于 amountInMax，退还多余的代币
        if (payerIsUser && amountIn < amountInMax) {
            // 对于 payerIsUser=true，不需要退款，因为只拉取了 amountIn
        } else if (!payerIsUser && amountIn < amountInMax) {
            // 对于 payerIsUser=false，退还多余的代币给 recipient
            uint256 refund = amountInMax - amountIn;
            IERC20(tokenIn).transfer(recipient, refund);
        }

        emit SwapExecuted(V3_SWAP_EXACT_OUT, tokenIn, tokenOut, amountIn, amountOut, recipient);
    }

    /**
     * @dev 解析交换路径
     * @param path 编码的路径 (tokenIn, fee, tokenOut)
     */
    function _decodePath(bytes memory path) internal pure returns (
        address tokenIn,
        uint24 fee,
        address tokenOut
    ) {
        require(path.length >= 43, "Invalid path length"); // 20 + 3 + 20 = 43 bytes

        assembly {
            tokenIn := mload(add(path, 20))
            fee := mload(add(path, 23))
            tokenOut := mload(add(path, 43))
        }
    }

    /**
     * @dev 根据输入量计算输出量
     * 模拟价格：1 WLTC = 120 USDC
     */
    function _calculateAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (uint256 amountOut) {
        if (tokenIn == address(wltc) && tokenOut == address(usdc)) {
            // WLTC -> USDC: amountIn (18 decimals) * 120 / 1e18 * (1 - slippage)
            amountOut = (amountIn * MOCK_PRICE) / PRICE_PRECISION;
            amountOut = (amountOut * (10000 - SLIPPAGE)) / 10000;
        } else if (tokenIn == address(usdc) && tokenOut == address(wltc)) {
            // USDC -> WLTC: amountIn (6 decimals) * 1e18 / 120 * (1 - slippage)
            amountOut = (amountIn * PRICE_PRECISION) / MOCK_PRICE;
            amountOut = (amountOut * (10000 - SLIPPAGE)) / 10000;
        } else {
            revert("Unsupported token pair");
        }
    }

    /**
     * @dev 根据输出量计算输入量
     * 模拟价格：1 WLTC = 120 USDC
     * ⚠️ 注意：不在这里添加滑点，滑点由调用者（AMMSwap）在 amountInMax 中处理
     */
    function _calculateAmountIn(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) internal view returns (uint256 amountIn) {
        if (tokenIn == address(usdc) && tokenOut == address(wltc)) {
            // USDC -> WLTC: amountOut (18 decimals) * 120 / 1e18
            amountIn = (amountOut * MOCK_PRICE) / PRICE_PRECISION;
            // 不再添加滑点：amountIn = (amountIn * (10000 + SLIPPAGE)) / 10000;
        } else if (tokenIn == address(wltc) && tokenOut == address(usdc)) {
            // WLTC -> USDC: amountOut (6 decimals) * 1e18 / 120
            amountIn = (amountOut * PRICE_PRECISION) / MOCK_PRICE;
            // 不再添加滑点：amountIn = (amountIn * (10000 + SLIPPAGE)) / 10000;
        } else {
            revert("Unsupported token pair");
        }
    }

    /**
     * @dev 向 mock router 添加流动性（用于测试）
     * @param wltcAmount WLTC 数量
     * @param usdcAmount USDC 数量
     */
    function addLiquidity(uint256 wltcAmount, uint256 usdcAmount) external {
        if (wltcAmount > 0) {
            wltc.transferFrom(msg.sender, address(this), wltcAmount);
        }
        if (usdcAmount > 0) {
            usdc.transferFrom(msg.sender, address(this), usdcAmount);
        }
    }

    /**
     * @dev 查询合约代币余额
     */
    function getBalances() external view returns (uint256 wltcBalance, uint256 usdcBalance) {
        wltcBalance = wltc.balanceOf(address(this));
        usdcBalance = usdc.balanceOf(address(this));
    }
}
