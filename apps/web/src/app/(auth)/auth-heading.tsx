export function AuthHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h1 className="m-0 text-2xl font-semibold tracking-tight text-[#0a2463]">{title}</h1>
      {description && <p className="m-0 mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
