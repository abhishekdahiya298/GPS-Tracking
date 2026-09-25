"use client";

export function ExitViewAs() {
  return (
    <button
      onClick={async () => {
        const res = await fetch("/api/admin/view-as", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: null }) });
        if (res.ok) window.location.assign("/admin/customers");
      }}
    >
      Exit
    </button>
  );
}
