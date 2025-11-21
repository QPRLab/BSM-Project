// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../AMMSwap.sol";

/**
 * @title PriceCalculationTestHelper
 * @notice 测试辅助合约，用于测试 AMMSwap._sqrtPriceX96ToPrice 函数
 * @dev 模拟 Uniswap V3 Pool 并暴露内部价格计算函数
 */
contract PriceCalculationTestHelper {
    address public token0;
    address public token1;
    uint160 public sqrtPriceX96;
    
    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
        // 默认设置一个合理的价格
        sqrtPriceX96 = 1973640151734515651856560; // ~$122.96
    }
    
    /**
     * @notice 设置 sqrtPriceX96（模拟 Uniswap V3 Pool 的 slot0）
     */
    function setSqrtPriceX96(uint160 _sqrtPriceX96) external {
        sqrtPriceX96 = _sqrtPriceX96;
    }
    
    /**
     * @notice 模拟 Uniswap V3 Pool 的 slot0() 函数
     */
    function slot0() external view returns (
        uint160 sqrtPriceX96_,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    ) {
        sqrtPriceX96_ = sqrtPriceX96;
        tick = 228203; // 对应的 tick 值
        observationIndex = 0;
        observationCardinality = 1;
        observationCardinalityNext = 1;
        feeProtocol = 0;
        unlocked = true;
    }
    
    /**
     * @notice 测试价格计算函数
     * @dev 与 AMMSwap._sqrtPriceX96ToPrice 完全一致
     * 
     * 注意: 这里假设 token0 总是 USDC，token1 总是 Underlying (WLTC)
     * 这与测试中的设置一致
     */
    function testSqrtPriceX96ToPrice(
        uint160 _sqrtPriceX96,
        bool isUsdcToUnderlying
    ) external view returns (uint256 price) {
        require(_sqrtPriceX96 > 0, "Invalid sqrtPriceX96");
        
        uint256 Q96 = 0x1000000000000000000000000; // 2^96
        uint256 sqrtPriceX96_squared = uint256(_sqrtPriceX96) * uint256(_sqrtPriceX96);
        uint256 price_18decimals = _mulDiv(sqrtPriceX96_squared, 1e18, Q96 * Q96);
        
        // 在测试环境中，token0 始终是 USDC (6 decimals)，token1 始终是 WLTC (18 decimals)
        if (isUsdcToUnderlying) {
            // 需要: underlying/usdc (1 USDC = ? WLTC)
            // price_18decimals 是 token1/token0 = WLTC/USDC
            price = price_18decimals / 1e12; // 调整到 18 decimals (WLTC 精度)
        } else {
            // 需要: usdc/underlying (1 WLTC = ? USDC)  
            // 需要反转价格
            require(price_18decimals > 0, "Price is zero");
            price = _mulDiv(1e36, 1, price_18decimals); // 结果是 6 decimals (USDC 精度)
        }
        
        require(price > 0, "Calculated price is zero");
    }
    
    /**
     * @dev 计算 (a × b) / c，参考 Uniswap FullMath
     */
    function _mulDiv(uint256 a, uint256 b, uint256 c) private pure returns (uint256) {
        require(c > 0, "Division by zero");
        
        uint256 prod0;
        uint256 prod1;
        assembly {
            let mm := mulmod(a, b, not(0))
            prod0 := mul(a, b)
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        
        if (prod1 == 0) {
            return prod0 / c;
        }
        
        require(prod1 < c, "MulDiv overflow");
        
        uint256 remainder;
        assembly {
            remainder := mulmod(a, b, c)
        }
        
        assembly {
            prod1 := sub(prod1, gt(remainder, prod0))
            prod0 := sub(prod0, remainder)
        }
        
        uint256 twos = c & (~c + 1);
        assembly {
            c := div(c, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        
        prod0 |= prod1 * twos;
        
        uint256 inv = (3 * c) ^ 2;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        inv *= 2 - c * inv;
        
        return prod0 * inv;
    }
    
    /**
     * @notice 使用真实的 token 地址进行测试
     */
    function testSqrtPriceX96ToPriceWithTokens(
        uint160 _sqrtPriceX96,
        bool isUsdcToUnderlying,
        address usdcToken,
        address underlyingToken
    ) external view returns (uint256 price) {
        uint256 Q96 = 0x1000000000000000000000000; // 2^96
        uint256 priceX192 = uint256(_sqrtPriceX96) * uint256(_sqrtPriceX96);
        
        if (isUsdcToUnderlying) {
            if (token0 == usdcToken) {
                // token0=USDC, token1=Underlying
                uint256 numerator = priceX192 * (10 ** 18);
                uint256 denominator = Q96 * Q96 * (10 ** 30);
                price = numerator / denominator;
            } else {
                // token0=Underlying, token1=USDC
                uint256 numerator = Q96 * Q96 * (10 ** 18);
                uint256 denominator = priceX192 * (10 ** 30);
                price = numerator / denominator;
            }
        } else {
            if (token0 == underlyingToken) {
                // token0=Underlying, token1=USDC
                uint256 numerator = priceX192 * (10 ** 30);
                uint256 denominator = Q96 * Q96 * (10 ** 18);
                price = numerator / denominator;
            } else {
                // token0=USDC, token1=Underlying
                uint256 numerator = Q96 * Q96 * (10 ** 30);
                uint256 denominator = priceX192 * (10 ** 18);
                price = numerator / denominator;
            }
        }
        
        require(price > 0, "Calculated price is zero");
    }
}
