/**
 * Re-mounted on every navigation inside the signed-in app, so each page fades in
 * instead of popping. Opacity only (see rio-fade in globals.css).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade">{children}</div>;
}
