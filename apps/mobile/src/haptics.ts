/**
 * Small touch feedback. Every call is fire-and-forget and never throws: haptics are missing
 * on some Android phones and in simulators, and a failed buzz must not break a tap.
 */
import * as Haptics from "expo-haptics";

const quiet = (p: Promise<void>) => void p.catch(() => undefined);

export const haptic = {
  /** A light tick for ordinary taps: rows, chips, tabs. */
  tap: () => quiet(Haptics.selectionAsync()),
  /** A firmer bump for primary actions. */
  press: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning))
};
