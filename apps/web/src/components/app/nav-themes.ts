/**
 * Side-menu styles a person can choose in My account (Menu style). Only colours and surfaces
 * change; the layout, order and behaviour of the menu are identical in all three.
 */
export const NAV_THEMES = ["gradient", "light", "glass"] as const;
export type NavTheme = (typeof NAV_THEMES)[number];
export const DEFAULT_NAV_THEME: NavTheme = "gradient";

export const NAV_THEME_LABEL: Record<NavTheme, { label: string; hint: string }> = {
  gradient: { label: "Modern gradient", hint: "RIO blue with the red accent (recommended)" },
  light: { label: "Minimal light", hint: "White and soft blue, easy on bright screens" },
  glass: { label: "Dark glass", hint: "Deep night blue, easy on the eyes at night" }
};

export interface NavThemeClasses {
  root: string;
  brandOuter: string;
  brandInner: string;
  sectionTitle: string;
  group: string;
  divider: string;
  lone: string;
  idle: string;
  active: string;
  accent: string;
  tileIdle: string;
  tileActive: string;
  chevronIdle: string;
  chevronActive: string;
  footer: string;
  avatar: string;
  footerTitle: string;
  footerSub: string;
  focus: string;
  dots: string;
}

export const NAV_THEME_CLASSES: Record<NavTheme, NavThemeClasses> = {
  gradient: {
    root: "bg-[linear-gradient(180deg,#071a4a_0%,#0a2463_45%,#0d2f80_100%)] text-white",
    brandOuter: "bg-[linear-gradient(135deg,#e2e8f5,#ffffff_35%,#ffffff_65%,#d81e2c)] p-[2px] shadow-[0_8px_24px_rgb(0_0_0/0.35)]",
    brandInner: "bg-white",
    sectionTitle: "text-white/70",
    group: "border border-white/15 bg-white/[0.04] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]",
    divider: "border-white/10",
    lone: "border border-white/15",
    idle: "text-white/90 hover:bg-white/[0.08] hover:text-white",
    active: "border-white/25 bg-[linear-gradient(90deg,#1849c6,#0d38a8)] font-semibold text-white shadow-[0_6px_18px_rgb(13_56_168/0.55)]",
    accent: "bg-[#ff3b47] shadow-[0_0_10px_#ff3b47]",
    tileIdle: "bg-white/[0.08] text-white/85 group-hover:bg-white/15 group-hover:text-white",
    tileActive: "bg-white/15 text-white",
    chevronIdle: "text-white/55",
    chevronActive: "text-white",
    footer: "border-white/15 bg-white/[0.07]",
    avatar: "bg-white text-[#0a2463] ring-white/30",
    footerTitle: "text-white",
    footerSub: "text-white/70",
    focus: "focus-visible:outline-white",
    dots: "bg-[radial-gradient(rgb(255_255_255/0.07)_1px,transparent_1px)]"
  },
  light: {
    root: "border-r border-[#e3e8f2] bg-[linear-gradient(180deg,#f8faff_0%,#eef3fc_100%)] text-[#0a2463]",
    brandOuter: "bg-white p-[1px] shadow-[0_4px_14px_rgb(10_36_99/0.08)] ring-1 ring-[#e3e8f2]",
    brandInner: "bg-white",
    sectionTitle: "text-[#5b6472]",
    group: "border border-[#e3e8f2] bg-white shadow-[0_1px_2px_rgb(10_36_99/0.05)]",
    divider: "border-[#eef1f6]",
    lone: "border border-[#e3e8f2] bg-white",
    idle: "text-[#0a2463] hover:bg-[#f2f6fd]",
    active: "border-[#cddcfa] bg-[#e3ecfd] font-semibold text-[#0a2463]",
    accent: "bg-[#1849c6]",
    tileIdle: "bg-[#f3f6fb] text-[#0a2463] group-hover:bg-[#e3ecfd]",
    tileActive: "bg-white text-[#1849c6]",
    chevronIdle: "text-[#9aa4b5]",
    chevronActive: "text-[#1849c6]",
    footer: "border-[#e3e8f2] bg-white",
    avatar: "bg-[#0a2463] text-white ring-[#e3ecfd]",
    footerTitle: "text-[#0a2463]",
    footerSub: "text-[#5b6472]",
    focus: "focus-visible:outline-[#1849c6]",
    dots: "bg-[radial-gradient(rgb(10_36_99/0.05)_1px,transparent_1px)]"
  },
  glass: {
    root: "bg-[linear-gradient(180deg,#0c1426_0%,#070d1a_60%,#04070f_100%)] text-white",
    brandOuter: "bg-white/10 p-[1px] shadow-[0_8px_24px_rgb(0_0_0/0.55)] ring-1 ring-white/15",
    brandInner: "bg-[linear-gradient(135deg,rgb(255_255_255/0.94),rgb(222_230_245/0.9))]",
    sectionTitle: "text-white/55",
    group: "border border-white/10 bg-white/[0.035] backdrop-blur",
    divider: "border-white/[0.07]",
    lone: "border border-white/10 bg-white/[0.03]",
    idle: "text-white/85 hover:bg-white/[0.06] hover:text-white",
    active: "border-[#38bdf8]/50 bg-[linear-gradient(90deg,rgb(29_78_216/0.6),rgb(14_165_233/0.22))] font-semibold text-white shadow-[0_0_18px_rgb(56_189_248/0.3)]",
    accent: "bg-[#38bdf8] shadow-[0_0_10px_#38bdf8]",
    tileIdle: "bg-white/[0.06] text-white/80 group-hover:bg-white/[0.12] group-hover:text-white",
    tileActive: "bg-[#38bdf8]/20 text-white",
    chevronIdle: "text-white/40",
    chevronActive: "text-white",
    footer: "border-white/10 bg-white/[0.05]",
    avatar: "bg-white/90 text-[#0b1222] ring-white/20",
    footerTitle: "text-white",
    footerSub: "text-white/60",
    focus: "focus-visible:outline-[#38bdf8]",
    dots: "bg-[radial-gradient(rgb(255_255_255/0.05)_1px,transparent_1px)]"
  }
};

export function navTheme(v: string | null | undefined): NavTheme {
  return (NAV_THEMES as readonly string[]).includes(v ?? "") ? (v as NavTheme) : DEFAULT_NAV_THEME;
}
