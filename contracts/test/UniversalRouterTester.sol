// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/**
 * @title UniversalRouterTester
 * @notice 测试合约，用于验证从智能合约调用 UniversalRouter 的行为
 */
contract UniversalRouterTester {
    address public owner;
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice 从合约调用 UniversalRouter 进行 EXACT_OUTPUT swap
     * @param router UniversalRouter 地址
     * @param tokenIn 输入代币地址
     * @param commands 命令字节
     * @param inputs 编码的输入参数
     * @param deadline 截止时间
     */
    function executeSwapFromContract(
        address router,
        address tokenIn,
        uint256 approveAmount,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external {
        require(msg.sender == owner, "Only owner");
        
        // 授权 UniversalRouter
        IERC20(tokenIn).approve(router, approveAmount);
        
        // 调用 UniversalRouter
        IUniversalRouter(router).execute(commands, inputs, deadline);
    }
    
    /**
     * @notice 从用户转入代币到合约
     */
    function depositToken(address token, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
    
    /**
     * @notice 提取代币
     */
    function withdrawToken(address token, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        IERC20(token).transferFrom(address(this), msg.sender, amount);
    }
    
    /**
     * @notice 查询合约代币余额
     */
    function getBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
