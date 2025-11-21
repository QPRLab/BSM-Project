// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMultiLeverageToken{
    
    // 检查token是否存在
    function tokenExists(uint256 tokenId) external view returns (bool);
    
    // 获取用户token余额
    function balanceOfInWei(address account, uint256 id) external view returns (uint256);
}