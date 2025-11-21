// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IAuctionManager {
        function startAuction(
        uint256 underlyingAmount, // 底层资产数量 
        address originalOwner,    // 被清算用户地址
        uint256 tokenId,          // tokenID
        address triggerer         // 将接收激励的地址
        ) external returns (uint256 auctionId);
    
}