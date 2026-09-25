export function AuthHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h1 className="m-0 text-xl font-semibold text-foreground">{title}</h1>
      {description && <p className="m-0 mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
