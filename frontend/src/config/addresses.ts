import deployed from './deployed_addresses.json'

export type AddressesMap = Record<string, string>

// Typed constant for easy imports in the frontend
export const ADDRESSES = deployed as AddressesMap

export function getAddress(key: string): string | undefined {
  return (ADDRESSES as AddressesMap)[key]
}

// --- Named exports for all entries in deployed_addresses.json ---
export const WLTCMockAddress = getAddress('tokenModules#WLTCMock')
export const USDCMockAddress = getAddress('tokenModules#USDCMock')
export const StableTokenAddress = getAddress('tokenModules#StableToken')
export const MultiLeverageTokenAddress = getAddress('tokenModules#MultiLeverageToken')

export const InterestManagerAddress = getAddress('coreModules#InterestManager')
export const LTCPriceOracleAddress = getAddress('coreModules#LTCPriceOracle')
export const CustodianFixedAddress = getAddress('coreModules#CustodianFixed')
export const LinearDecreaseAddress = getAddress('coreModules#LinearDecrease')
export const AuctionManagerAddress = getAddress('coreModules#AuctionManager')
export const LiquidationManagerAddress = getAddress('coreModules#LiquidationManager')

export const AMMLiquidityAddress = getAddress('ammModules#AMMLiquidity')
export const AMMSwapAddress = getAddress('ammModules#AMMSwap')