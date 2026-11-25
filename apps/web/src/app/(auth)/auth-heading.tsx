export function AuthHeading({ title, description, compact }: { title: string; description?: string; compact?: boolean }) {
  return (
    <div className={compact ? "mb-1" : "mb-5"}>
      <h1 className={`m-0 font-semibold tracking-tight text-[#0a2463] dark:text-foreground ${compact ? "text-[22px]" : "text-2xl"}`}>{title}</h1>
      {description && <p className="m-0 mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
