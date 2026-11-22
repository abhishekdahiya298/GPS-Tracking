const APPLE =
  "M16.37 12.6c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.78.74 2.99.72 1.24-.02 2.02-1.12 2.77-2.23.88-1.28 1.24-2.52 1.26-2.59-.03-.01-2.4-.92-2.4-3.68zM14.1 5.86c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.27z";

function Badge({ href, label, small, big, children }: { href: string; label: string; small: string; big: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex h-11 min-w-[140px] items-center gap-2.5 rounded-[10px] border border-black/80 bg-black px-3 text-white no-underline shadow-sm hover:bg-[#1c1c1e] dark:border-white/25"
    >
      {children}
      <span className="flex flex-col leading-none">
        <span className="text-[10px] font-medium tracking-wide text-white/85">{small}</span>
        <span className="mt-0.5 text-[17px] font-semibold tracking-tight">{big}</span>
      </span>
    </a>
  );
}

/** "Download on the App Store" / "Get it on Google Play" buttons for the driver and manager app. */
export function StoreBadges({ ios, android, className = "" }: { ios: string; android: string; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-2.5 ${className}`}>
      <Badge href={ios} label="Download RIO GPS on the App Store" small="Download on the" big="App Store">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={APPLE} />
        </svg>
      </Badge>
      <Badge href={android} label="Get RIO GPS on Google Play" small="GET IT ON" big="Google Play">
        <svg width="21" height="23" viewBox="0 0 21 23" aria-hidden="true">
          <path d="M.6.4C.4.7.3 1 .3 1.5v20c0 .5.1.8.3 1.1l11-11.1L.6.4z" fill="#00d7fe" />
          <path d="m15.2 15.2-3.6-3.7L.6 22.6c.4.4 1.1.5 1.8.1l12.8-7.5" fill="#f83750" />
          <path d="M15.2 7.8 2.4.3C1.7-.1 1 0 .6.4l11 11.1 3.6-3.7z" fill="#00f076" />
          <path d="m19.6 10.3-4.4-2.5-3.6 3.7 3.6 3.7 4.4-2.6c1.1-.6 1.1-1.7 0-2.3z" fill="#ffd500" />
        </svg>
      </Badge>
    </div>
  );
}
