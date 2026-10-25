export interface CustomShadows {
  z1?: string;
  z4?: string;
  z8?: string;
  z12?: string;
  z16?: string;
  z20?: string;
  z24?: string;
  primary?: string;
  secondary?: string;
  card?: string;
  dialog?: string;
  dropdown?: string;
}

export const customShadows = {
  light: {
    z1: "0 1px 2px 0 rgba(145, 158, 171, 0.16)",
    z4: "0 4px 8px 0 rgba(145, 158, 171, 0.16)",
    z8: "0 8px 16px 0 rgba(145, 158, 171, 0.16)",
    z12: "0 12px 24px -4px rgba(145, 158, 171, 0.16)",
    z16: "0 16px 32px -4px rgba(145, 158, 171, 0.16)",
    z20: "0 20px 40px -4px rgba(145, 158, 171, 0.16)",
    z24: "0 24px 48px 0 rgba(145, 158, 171, 0.16)",
    dialog: "-40px 40px 80px -8px rgba(0, 0, 0, 0.24)",
    card: "0 0 2px 0 rgba(145, 158, 171, 0.2), 0 12px 24px -4px rgba(145, 158, 171, 0.12)",
    dropdown: "0 0 2px 0 rgba(145, 158, 171, 0.24), -20px 20px 40px -4px rgba(145, 158, 171, 0.24)",
    primary: "0 8px 16px 0 rgba(24, 119, 242, 0.24)",
    secondary: "0 8px 16px 0 rgba(142, 51, 255, 0.24)"
  },
  dark: {
    z1: "0 1px 2px 0 rgba(0, 0, 0, 0.16)",
    z4: "0 4px 8px 0 rgba(0, 0, 0, 0.16)",
    z8: "0 8px 16px 0 rgba(0, 0, 0, 0.16)",
    z12: "0 12px 24px -4px rgba(0, 0, 0, 0.16)",
    z16: "0 16px 32px -4px rgba(0, 0, 0, 0.16)",
    z20: "0 20px 40px -4px rgba(0, 0, 0, 0.16)",
    z24: "0 24px 48px 0 rgba(0, 0, 0, 0.16)",
    dialog: "-40px 40px 80px -8px rgba(0, 0, 0, 0.48)",
    card: "0 0 2px 0 rgba(0, 0, 0, 0.4), 0 12px 24px -4px rgba(0, 0, 0, 0.24)",
    dropdown: "0 0 2px 0 rgba(0, 0, 0, 0.48), -20px 20px 40px -4px rgba(0, 0, 0, 0.48)",
    primary: "0 8px 16px 0 rgba(97, 243, 243, 0.24)",
    secondary: "0 8px 16px 0 rgba(255, 171, 0, 0.24)"
  }
};
