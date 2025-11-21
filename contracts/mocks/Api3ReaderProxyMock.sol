// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IApi3ReaderProxy {
    function read() external view returns (int224 value, uint32 timestamp);
}

contract Api3ReaderProxyMock is IApi3ReaderProxy {
    int224 private _value;
    uint32 private _timestamp;

    constructor(int224 value_, uint32 timestamp_) {
        _value = value_;
        _timestamp = timestamp_;
    }

    function read() external view returns (int224 value, uint32 timestamp) {
        return (_value, _timestamp);
    }

    function set(int224 value_, uint32 timestamp_) external {
        _value = value_;
        _timestamp = timestamp_;
    }
}
