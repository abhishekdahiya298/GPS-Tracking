/** "Priya Nair · joining Dhillon Transport": who the invite is for, so the driver knows it's theirs. */
export function DriverAvatarChip({ driverName, companyName }: { driverName: string; companyName: string }) {
  const initials = driverName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div className="mx-auto flex w-fit max-w-full items-center gap-2.5 rounded-full bg-success-soft py-1 pl-1 pr-3.5 shadow-[inset_0_0_0_1px_rgb(22_163_74/0.3)]">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[linear-gradient(150deg,#2456d6,#0a2463)] text-xs font-bold text-white">
        {initials}
      </span>
      <span className="min-w-0 leading-tight">
        <b className="block truncate text-[13px] text-foreground">{driverName}</b>
        <span className="block truncate text-[11.5px] text-success">Joining {companyName}</span>
      </span>
    </div>
  );
}
