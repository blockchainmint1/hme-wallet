/** Read-only evidence parser. A decoded header is NEVER execution authorization. */
import { getAddress, type Address, type Hex } from "viem";

export function inspectNordsternHeader(data: Hex) {
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(data) || data.slice(0, 10).toLowerCase() !== "0x3f0bde25" ||
      (data.length - 2) / 2 < 139) throw new Error("Invalid or truncated Nordstern packed header");
  const bytes = (start: number, end: number) => `0x${data.slice(2 + start * 2, 2 + end * 2)}` as Hex;
  const address = (start: number): Address => getAddress(bytes(start, start + 20));
  return {
    id: Number(BigInt(bytes(4, 6))), executor: address(6), amountIn: BigInt(bytes(26, 42)),
    minAmountOut: BigInt(bytes(42, 58)), executorHeaderByte: Number(BigInt(bytes(58, 59))),
    firstTokenReceiver: address(59), recipient: address(79), tokenIn: address(99), tokenOut: address(119),
    // This program must be independently decoded and authorized before spending.
    unreviewedProgram: bytes(139, (data.length - 2) / 2),
  };
}