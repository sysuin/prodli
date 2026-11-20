// ProdLi's look on the phone: the same neo-brutalist palette as the extension
// (artifacts/prodli/src/index.css): square corners, heavy borders, yellow.
import { useColorScheme } from "react-native";
import { useStored } from "../lib/store";

export interface Theme {
  dark: boolean;
  bg: string;
  card: string;
  fg: string;
  muted: string;
  mutedFg: string;
  border: string;
  shadow: string;
  primary: string;
  primaryFg: string;
  secondary: string;
  accent: string;
  danger: string;
  success: string;
  ask: string;
}

export const LIGHT: Theme = {
  dark: false,
  bg: "#EDE1CF",
  card: "#F2E2CA",
  fg: "#231E1A",
  muted: "#E1D4C1",
  mutedFg: "#564C43",
  border: "#000000",
  shadow: "#000000",
  primary: "#FFD700",
  primaryFg: "#000000",
  secondary: "#33BBFF",
  accent: "#FF3399",
  danger: "#D90000",
  success: "#2E7D32",
  ask: "#A78BFA",
};

export const DARK: Theme = {
  dark: true,
  bg: "#171A21",
  card: "#23262F",
  fg: "#D9DDE3",
  muted: "#272B34",
  mutedFg: "#9EA7B3",
  border: "#FFD700",
  shadow: "#000000",
  primary: "#FFD700",
  primaryFg: "#000000",
  secondary: "#33BBFF",
  accent: "#FF3399",
  danger: "#FF6B6B",
  success: "#66BB6A",
  ask: "#A78BFA",
};

export const LOGO = { yellow: "#FFD700", cyan: "#00BCD4", red: "#FF6B6B", green: "#66BB6A", frame: "#000000" } as const;

export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "mobileTheme";

export function useTheme(): Theme {
  const system = useColorScheme();
  const pref = useStored<ThemePref>(THEME_KEY, "system");
  const dark = pref === "system" ? system === "dark" : pref === "dark";
  return dark ? DARK : LIGHT;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const font = { title: 26, h2: 18, body: 15, small: 13, tiny: 11 } as const;
