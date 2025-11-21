// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../Types.sol";
import "../interfaces/IChainlinkV3.sol";


library CustodianUtils {
    uint256 public constant PRICE_PRECISION = 1e18;

    // Mint計算
    function calculateMintAmounts(
        uint256 underlyingAmountInWei,
        LeverageType leverage,
        uint256 mintPriceInWei
    ) internal pure returns (
        uint256 sAmountInWei,
        uint256 lAmountInWei
    ) {
        if (leverage == LeverageType.CONSERVATIVE) {
            sAmountInWei = underlyingAmountInWei * mintPriceInWei / (9 * PRICE_PRECISION);
            lAmountInWei = 8 * sAmountInWei;
        } else if (leverage == LeverageType.MODERATE) {
            sAmountInWei = underlyingAmountInWei * mintPriceInWei / (5 * PRICE_PRECISION);
            lAmountInWei = 4 * sAmountInWei;
        } else if (leverage == LeverageType.AGGRESSIVE) {
            sAmountInWei = underlyingAmountInWei * mintPriceInWei / (2 * PRICE_PRECISION);
            lAmountInWei = sAmountInWei;
        } else {
            revert("Invalid leverage level");
        }
    }

    // Burn/Preview計算
    function previewBurn(
        uint8 underlyingTokenDecimals,
        uint256 totalLAmountInWei,
        LeverageType leverage,
        uint256 mintPrice,
        uint256 lAmountPercentage,
        uint256 currentPriceInWei,
        uint256 totalInterestInWei
    ) internal pure returns (BurnPreview memory result) {
        result.lAmountBurnedInWei = totalLAmountInWei * lAmountPercentage / 100;
        require(result.lAmountBurnedInWei > 0, "Calculated burn amount is zero");
        if (leverage == LeverageType.CONSERVATIVE) {
            result.sAmountNeededInWei = result.lAmountBurnedInWei / 8;
            result.underlyingAmountInWei = 9 * result.sAmountNeededInWei * PRICE_PRECISION / mintPrice;
        } else if (leverage == LeverageType.MODERATE) {
            result.sAmountNeededInWei = result.lAmountBurnedInWei / 4;
            result.underlyingAmountInWei = 5 * result.sAmountNeededInWei * PRICE_PRECISION / mintPrice;
        } else if (leverage == LeverageType.AGGRESSIVE) {
            result.sAmountNeededInWei = result.lAmountBurnedInWei;
            result.underlyingAmountInWei = 2 * result.sAmountNeededInWei * PRICE_PRECISION / mintPrice;
        } else {
            revert("Invalid leverage level");
        }
        if(currentPriceInWei > 0) {
            result.deductInterestInWei = lAmountPercentage * totalInterestInWei / 100;
            uint256 deductUnderlyingAmountInWei = result.deductInterestInWei * PRICE_PRECISION / currentPriceInWei;
            require(deductUnderlyingAmountInWei <= result.underlyingAmountInWei, "Invalid deduct amount");
            if (underlyingTokenDecimals == 18) {
                result.underlyingAmountToInterestManager = deductUnderlyingAmountInWei;
                result.underlyingAmountToUser = result.underlyingAmountInWei - result.underlyingAmountToInterestManager;
            } else if (underlyingTokenDecimals < 18) {
                result.underlyingAmountToInterestManager = deductUnderlyingAmountInWei / (10 ** (18 - underlyingTokenDecimals));
                result.underlyingAmountToUser = result.underlyingAmountInWei / (10 ** (18 - underlyingTokenDecimals)) - result.underlyingAmountToInterestManager;
            } else {
                result.underlyingAmountToInterestManager = deductUnderlyingAmountInWei * (10 ** (underlyingTokenDecimals - 18));
                result.underlyingAmountToUser = result.underlyingAmountInWei * (10 ** (underlyingTokenDecimals - 18)) - result.underlyingAmountToInterestManager;
            }
        } else {
            result.deductInterestInWei = 0;
            result.underlyingAmountToInterestManager = 0;
            result.underlyingAmountToUser = result.underlyingAmountInWei;
        }
    }

    // NAV計算
    function calculateNav(
        LeverageType leverage,
        uint256 mintPrice,
        uint256 currentPriceInWei
    ) internal pure returns (uint256 grossNavInWei) {
        if (leverage == LeverageType.CONSERVATIVE) {
            uint256 left = 9 * currentPriceInWei;
            if (left <= mintPrice) return 0;
            uint256 numerator = left - mintPrice;
            uint256 denominator = 8 * mintPrice;
            grossNavInWei = numerator * PRICE_PRECISION / denominator;
        } else if (leverage == LeverageType.MODERATE) {
            uint256 left = 5 * currentPriceInWei;
            if (left <= mintPrice) return 0;
            uint256 numerator = left - mintPrice;
            uint256 denominator = 4 * mintPrice;
            grossNavInWei = numerator * PRICE_PRECISION / denominator;
        } else if (leverage == LeverageType.AGGRESSIVE) {
            uint256 left = 2 * currentPriceInWei;
            if (left <= mintPrice) return 0;
            uint256 numerator = left - mintPrice;
            uint256 denominator = mintPrice;
            grossNavInWei = numerator * PRICE_PRECISION / denominator;
        } else {
            revert("Invalid leverage type");
        }
    }

    // Mint預覽
    function previewMint(
        uint256 underlyingAmountInWei,
        LeverageType leverage,
        uint256 mintPriceInWei,
        uint256 currentPriceInWei
    ) internal pure returns (
        uint256 sAmountInWei,
        uint256 lAmountInWei,
        uint256 grossNavInWei
    ) {
        (sAmountInWei, lAmountInWei) = calculateMintAmounts(
            underlyingAmountInWei,
            leverage,
            mintPriceInWei
        );
        grossNavInWei = calculateNav(
            leverage,
            mintPriceInWei,
            currentPriceInWei
        );
    }

    // Oracle查詢
    function getLatestPriceView(
        IChainlinkV3 priceFeed,
        uint8 priceFeedDecimals,
        uint256 maxPriceAge
    ) internal view returns (
        uint256 priceInWei,
        uint256 timeInSecond,
        bool isValid
    ) {
        if (address(priceFeed) == address(0)) {
            return (0, 0, false);
        }
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 price,
            uint256,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            isValid = (
                price > 0 &&
                updatedAt > 0 &&
                block.timestamp - updatedAt <= maxPriceAge &&
                roundId > 0 &&
                answeredInRound >= roundId
            );
            if (isValid) {
                if (priceFeedDecimals < 18) {
                    priceInWei = uint256(price) * (10 ** (18 - priceFeedDecimals));
                } else if (priceFeedDecimals > 18) {
                    priceInWei = uint256(price) / (10 ** (priceFeedDecimals - 18));
                } else {
                    priceInWei = uint256(price);
                }
                timeInSecond = updatedAt;
            } else {
                priceInWei = 0;
                timeInSecond = 0;
            }
        } catch {
            return (0, 0, false);
        }
    }
}
