import { erc20Abi, parseAbi, type Address } from "viem";

/** Ethereum only. Sources: Sky chainlog and bgd-labs/aave-address-book AaveV3Ethereum.sol. */
export const EARN = {
  sky: { name: "sUSDS", protocol: "Sky", asset: "USDS", decimals: 18,
    underlying: "0xdC035D45d973E3EC169d2276DDab16f1e407384F" as Address,
    receipt: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD" as Address,
    target: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD" as Address,
    url: "https://sky.money" },
  aave: { name: "aEthUSDC", protocol: "Aave V3", asset: "USDC", decimals: 6,
    underlying: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    receipt: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c" as Address,
    target: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address,
    url: "https://aave.com" },
} as const;
export type EarnProtocol = keyof typeof EARN;
export type EarnAction = "deposit" | "withdraw";
export const tokenAbi = erc20Abi;
export const skyAbi = parseAbi([
  "function asset() view returns (address)",
  "function ssr() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
  "function maxDeposit(address receiver) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
]);
export const poolAbi = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getConfiguration(address asset) view returns ((uint256 data))",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);
export const aTokenAbi = parseAbi([
  "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
  "function POOL() view returns (address)",
]);
export const AAVE_DATA_PROVIDER = "0x0a16f2FCC0D44FaE41cc54e079281D84A363bECD" as Address;
export const AAVE_ADDRESSES_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e" as Address;
export const providerAbi = parseAbi(["function getPool() view returns (address)"]);
export const dataProviderAbi = parseAbi([
  "function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)",
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
]);

/** Deliberately unconditional: a UI preference must never enable spending. */
export function assertEarnExecution(): void {
  throw new Error("Earn deposits and withdrawals await independent safety review.");
}