/** A SIM's two numbers, labelled: MSISDN (network number) and ICCID (printed on the card). */
export function SimNumbers({ msisdn, iccid }: { msisdn: string | null; iccid: string }) {
  return (
    <div className="grid gap-0.5 text-xs">
      <div title="MSISDN: the SIM's number on the network">
        <span className="text-muted-foreground">MSISDN </span>
        <span className="font-mono font-medium text-foreground">{msisdn ?? "—"}</span>
      </div>
      <div title="ICCID: the number printed on the SIM card">
        <span className="text-muted-foreground">ICCID </span>
        <span className="font-mono text-foreground">{iccid}</span>
      </div>
    </div>
  );
}
