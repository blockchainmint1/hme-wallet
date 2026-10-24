import { createContext, useContext } from "react";

export type PreferenceScope = "phone" | "desktop";
export const PreferenceScopeContext = createContext<PreferenceScope>("phone");
export function usePreferenceScope() { return useContext(PreferenceScopeContext); }