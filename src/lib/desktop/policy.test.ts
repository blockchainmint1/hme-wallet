import { describe,it,expect } from "vitest";
import { desktopSwapAvailable,DESKTOP_EARN_EXECUTION_ENABLED } from "./policy";
describe("desktop execution restrictions",()=>{
 it("does not enable unreviewed Vault swaps",()=>expect(desktopSwapAvailable("vault",true)).toBe(false));
 it("retains enabled-chain restriction",()=>expect(desktopSwapAvailable("seed",false)).toBe(false));
 it("allows the existing reviewed non-Vault screen only for enabled chains",()=>expect(desktopSwapAvailable("seed",true)).toBe(true));
 it("keeps sUSDS execution off pending review",()=>expect(DESKTOP_EARN_EXECUTION_ENABLED).toBe(false));
});
