// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IAbacus {
    function price(uint256, uint256) external view returns (uint256);
}