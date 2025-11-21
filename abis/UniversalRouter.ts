/**
 * Uniswap UniversalRouter ABI and Commands
 * 
 * UniversalRouter Commands来自Uniswap官方实现：
 * https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Commands.sol
 * 
 * 每个命令都是一个字节码，用于指示UniversalRouter执行特定操作
 */

// UniversalRouter的execute函数ABI
export const UniversalRouterABI = [
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "permit2",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "weth9",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "v2Factory",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "v3Factory",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "pairInitCodeHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "poolInitCodeHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "v4PoolManager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "v3NFTPositionManager",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "v4PositionManager",
            "type": "address"
          }
        ],
        "internalType": "struct RouterParameters",
        "name": "params",
        "type": "tuple"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BalanceTooLow",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ContractLocked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "Currency",
        "name": "currency",
        "type": "address"
      }
    ],
    "name": "DeltaNotNegative",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "Currency",
        "name": "currency",
        "type": "address"
      }
    ],
    "name": "DeltaNotPositive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ETHNotAccepted",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "commandIndex",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "message",
        "type": "bytes"
      }
    ],
    "name": "ExecutionFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FromAddressIsNotOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InputLengthMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientBalance",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientETH",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InsufficientToken",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "action",
        "type": "bytes4"
      }
    ],
    "name": "InvalidAction",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidBips",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "commandType",
        "type": "uint256"
      }
    ],
    "name": "InvalidCommandType",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEthSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPath",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidReserves",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "LengthMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "NotAuthorizedForToken",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotPoolManager",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyMintAllowed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SliceOutOfBounds",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransactionDeadlinePassed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnsafeCast",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "action",
        "type": "uint256"
      }
    ],
    "name": "UnsupportedAction",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V2InvalidPath",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V2TooLittleReceived",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V2TooMuchRequested",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3InvalidAmountOut",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3InvalidCaller",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3InvalidSwap",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3TooLittleReceived",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3TooMuchRequested",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minAmountOutReceived",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amountReceived",
        "type": "uint256"
      }
    ],
    "name": "V4TooLittleReceived",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "maxAmountInRequested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amountRequested",
        "type": "uint256"
      }
    ],
    "name": "V4TooMuchRequested",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V3_POSITION_MANAGER",
    "outputs": [
      {
        "internalType": "contract INonfungiblePositionManager",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "V4_POSITION_MANAGER",
    "outputs": [
      {
        "internalType": "contract IPositionManager",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "commands",
        "type": "bytes"
      },
      {
        "internalType": "bytes[]",
        "name": "inputs",
        "type": "bytes[]"
      }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "commands",
        "type": "bytes"
      },
      {
        "internalType": "bytes[]",
        "name": "inputs",
        "type": "bytes[]"
      },
      {
        "internalType": "uint256",
        "name": "deadline",
        "type": "uint256"
      }
    ],
    "name": "execute",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "msgSender",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "poolManager",
    "outputs": [
      {
        "internalType": "contract IPoolManager",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "int256",
        "name": "amount0Delta",
        "type": "int256"
      },
      {
        "internalType": "int256",
        "name": "amount1Delta",
        "type": "int256"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "uniswapV3SwapCallback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      }
    ],
    "name": "unlockCallback",
    "outputs": [
      {
        "internalType": "bytes",
        "name": "",
        "type": "bytes"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "stateMutability": "payable",
    "type": "receive"
  }
] as const;

/**
 * UniversalRouter命令代码
 * 来源: https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Commands.sol
 * 
 * V3交易命令:
 * - V3_SWAP_EXACT_IN (0x00): 精确输入交易 - 指定输入token数量
 * - V3_SWAP_EXACT_OUT (0x01): 精确输出交易 - 指定输出token数量
 * 
 * V2交易命令:
 * - V2_SWAP_EXACT_IN (0x08): Uniswap V2精确输入
 * - V2_SWAP_EXACT_OUT (0x09): Uniswap V2精确输出
 * 
 * 其他常用命令:
 * - PERMIT2_TRANSFER_FROM (0x0a): 使用Permit2转账
 * - WRAP_ETH (0x0b): 包装ETH为WETH
 * - UNWRAP_WETH (0x0c): 解包WETH为ETH
 * - SWEEP (0x04): 扫清合约中的代币余额
 */
export const UniversalRouterCommands = {
  // V3 Swaps
  V3_SWAP_EXACT_IN: '0x00',
  V3_SWAP_EXACT_OUT: '0x01',
  
  // Permit2
  PERMIT2_PERMIT: '0x0a',
  PERMIT2_TRANSFER_FROM: '0x0b',
  
  // V2 Swaps
  V2_SWAP_EXACT_IN: '0x08',
  V2_SWAP_EXACT_OUT: '0x09',
  
  // ETH/WETH
  WRAP_ETH: '0x0b',
  UNWRAP_WETH: '0x0c',
  
  // Token Operations
  SWEEP: '0x04',
  TRANSFER: '0x00',
  PAY_PORTION: '0x06',
  
  // NFT/Position Operations
  MINT_POSITION: '0x11',
  INCREASE_LIQUIDITY: '0x12',
  DECREASE_LIQUIDITY: '0x13',
  COLLECT: '0x14',
  BURN_POSITION: '0x15',
} as const;

/**
 * V3_SWAP_EXACT_IN 参数说明 (命令 0x00)
 * 
 * 参数编码类型: (address, uint256, uint256, bytes, bool)
 * 
 * @param recipient - 接收代币的地址
 * @param amountIn - 输入代币数量（精确值）
 * @param amountOutMinimum - 输出代币的最小数量（滑点保护）
 * @param path - 交易路径编码 (address -> uint24 -> address)
 *               例如: encodePacked([tokenIn, fee, tokenOut])
 * @param payerIsUser - true表示代币从用户钱包扣除，false表示从router扣除
 */

/**
 * V3_SWAP_EXACT_OUT 参数说明 (命令 0x01)
 * 
 * 参数编码类型: (address, uint256, uint256, bytes, bool)
 * 
 * @param recipient - 接收代币的地址
 * @param amountOut - 输出代币数量（精确值）
 * @param amountInMaximum - 输入代币的最大数量（滑点保护）
 * @param path - 交易路径编码（注意：EXACT_OUT路径是反向的）
 *               例如: encodePacked([tokenOut, fee, tokenIn])
 * @param payerIsUser - true表示代币从用户钱包扣除，false表示从router扣除
 */
