/**
 * Helpers that make screens fit every phone: small and tall, with gesture bars or the old
 * three-button bar, and with the keyboard open.
 */
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Phones shorter than this (in points) get tighter spacing so nothing falls below the fold. */
export const COMPACT_HEIGHT = 700;

/**
 * The room a screen must leave at its bottom edge for the system navigation bar or gesture bar.
 * On Android the app draws behind that bar, so a button placed at the very bottom would be covered.
 */
export function useBottomInset(extra = 0): number {
  const { bottom } = useSafeAreaInsets();
  return bottom + extra;
}

/** Window size helpers: whether the phone is short, and a width-based scale for key sizes. */
export function useScreen() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    compact: height < COMPACT_HEIGHT,
    /** Scales a size designed for a 390pt-wide phone to this phone, within sensible limits. */
    scale: (size: number) => Math.round(size * Math.min(1.2, Math.max(0.85, width / 390)))
  };
}
