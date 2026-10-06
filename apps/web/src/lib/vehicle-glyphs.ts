/**
 * Side-view pictograms for each kind of vehicle, on a 24x24 grid facing right.
 * One definition drives both the map markers (canvas) and the list icons (SVG),
 * so a vehicle looks the same everywhere. Shapes are deliberately simple: they
 * are read at 14-18 px.
 */
import type { VehicleType } from "./schemas/vehicle";

export interface VehicleGlyph {
  /** Body silhouette (SVG path data). */
  body: string;
  /** Wheels as [centre x, radius]; they sit on the ground line (y = 16.5). */
  wheels: [number, number][];
}

export const WHEEL_Y = 16.5;

export const VEHICLE_GLYPHS: Record<VehicleType, VehicleGlyph> = {
  // Box truck: cargo box and a short cab.
  truck: { body: "M2 6.5h11.5v10H2zM14.5 9.5h3.6l3.4 3.6v3.4h-7z", wheels: [[6.2, 2], [17.2, 2]] },
  // Tractor unit: tall cab, low frame behind it, tandem rear axle.
  semi: { body: "M11 5.5h5.2l4.8 6v5H11zM2.5 13.5H11v3H2.5z", wheels: [[4.6, 1.8], [8.6, 1.8], [17, 2]] },
  // Trailer: long box, landing gear at the front, tandem axle at the back.
  trailer: { body: "M2 6h19v10H2zM17.2 16h1.3v3h-1.3zM21 13.4h2v1.4h-2z", wheels: [[5, 1.8], [9, 1.8]] },
  van: { body: "M2 7.5h11.6l4.6 4 3.3 1.1v3.9H2z", wheels: [[6.2, 2], [17, 2]] },
  // Pickup: open bed behind a cab.
  pickup: { body: "M2 11.5h8.6V7.8h4.6l3.2 3.7 3.1 1v4H2z", wheels: [[6.2, 2], [17, 2]] },
  car: { body: "M2.5 16.5v-3.2l3-1 2.4-4h7.2l3.4 4 3 1v3.2z", wheels: [[7, 2], [17, 2]] },
  bus: { body: "M2 5.5h18.5a1.5 1.5 0 0 1 1.500 1.5v9.5H2z", wheels: [[6.5, 2], [17, 2]] },
  // Equipment: tractor profile with one large drive wheel.
  equipment: { body: "M9.5 5.5h6.2l1 5h3.8v6H9.5zM3 11.5h6.5v5H3z", wheels: [[7, 3.2], [18, 2]] },
  // Anything else: a plain location dot.
  other: { body: "M12 6.500a5.500 5.500 0 1 0 0 11a5.500 5.500 0 1 0 0-11z", wheels: [] }
};
