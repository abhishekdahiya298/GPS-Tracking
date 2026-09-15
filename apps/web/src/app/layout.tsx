import type { ReactNode } from "react";

export const metadata = {
  title: "RIO GPS Tracking",
  description: "Live fleet GPS tracking"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
