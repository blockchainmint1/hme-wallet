/** Read-only public deployment evidence. Run with bun; no wallet, secret or transaction. */
import { createPublicClient, http, keccak256, parseAbi } from "viem";
import { mainnet, base, bsc } from "viem/chains";
import {
  LIFI_ALLOWED_SELECTORS, LIFI_DIAMOND, LIFI_GENERIC_FACET, LIFI_TIMELOCK,
  verifyLifiDeployment, type LifiChain,
} from "../src/lib/security/lifi-policy";
const networks = [
  { chain: "eth" as LifiChain, network: mainnet, rpc: "https://ethereum-rpc.publicnode.com" },
  { chain: "base" as LifiChain, network: base, rpc: "https://base-rpc.publicnode.com" },
  { chain: "bsc" as LifiChain, network: bsc, rpc: "https://bsc-rpc.publicnode.com" },
];
const evidence = await Promise.all(networks.map(async ({ chain, network, rpc }) => {
  const client = createPublicClient({ chain: network, transport: http(rpc) });
  await verifyLifiDeployment(chain, client);
  const blockNumber = await client.getBlockNumber();
  const abi = parseAbi([
    "function owner() view returns (address)",
    "function getMinDelay() view returns (uint256)",
    "function facetAddress(bytes4) view returns (address)",
  ]);
  const owner = await client.readContract({ address: LIFI_DIAMOND[chain], abi, functionName: "owner", blockNumber });
  const delay = await client.readContract({ address: LIFI_TIMELOCK[chain], abi, functionName: "getMinDelay", blockNumber });
  const facetCode = await client.getCode({ address: LIFI_GENERIC_FACET, blockNumber });
  if (!facetCode) throw new Error("Missing facet code");
  const mappings = await Promise.all(Object.keys(LIFI_ALLOWED_SELECTORS).map(async selector => ({
    selector,
    facet: await client.readContract({ address: LIFI_DIAMOND[chain], abi, functionName: "facetAddress", args: [selector as `0x${string}`], blockNumber }),
  })));
  return { chain, chainId: network.id, rpc, blockNumber: blockNumber.toString(),
    diamond: LIFI_DIAMOND[chain], owner, delaySeconds: delay.toString(), facetCodeHash: keccak256(facetCode), mappings };
}));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(),
  officialRevision: "c1e01594de237929926cec058f42ef66dea0bc82",
  limitation: "Single public RPC provider family; snapshot checks do not certify nested routes or reproducible bytecode builds.", evidence }, null, 2));