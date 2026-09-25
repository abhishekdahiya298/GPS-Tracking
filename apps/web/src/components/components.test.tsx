import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectivityBadge, StatusBadge } from "./app/status-badge";
import { EmptyState, ErrorState } from "./app/states";
import { PageHeader } from "./app/page-header";
import { Button, IconButton } from "./ui/button";
import { Field } from "./ui/label";
import { Alert } from "./ui/alert";

const html = (el: JSX.Element) => renderToStaticMarkup(el);

describe("design system", () => {
  it("Button defaults to type=button and shows busy state when loading", () => {
    expect(html(<Button>Save</Button>)).toContain('type="button"');
    const busy = html(<Button loading>Save</Button>);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain("disabled");
  });

  it("IconButton always has an accessible name", () => {
    const out = html(<IconButton label="Close panel">x</IconButton>);
    expect(out).toContain('aria-label="Close panel"');
  });

  it("status is conveyed by text, not colour alone", () => {
    expect(html(<StatusBadge tone="success" label="Online" />)).toContain("Online");
    expect(html(<ConnectivityBadge status="offline" />)).toContain("Offline");
    expect(html(<ConnectivityBadge status="never_seen" />)).toContain("No data yet");
  });

  it("Field wires the label to the control and announces errors", () => {
    const out = html(
      <Field id="name" label="Name" error="Required" required>
        <input id="name" />
      </Field>
    );
    expect(out).toContain('for="name"');
    expect(out).toContain('role="alert"');
    expect(out).toContain("Required");
  });

  it("empty and error states explain what to do next", () => {
    const empty = html(<EmptyState title="No vehicles yet" description="Add your first vehicle." action={<Button>Add vehicle</Button>} />);
    expect(empty).toContain("No vehicles yet");
    expect(empty).toContain("Add vehicle");
    expect(html(<ErrorState description="Unable to load vehicles." />)).toContain('role="alert"');
  });

  it("danger alerts are assertive, others polite", () => {
    expect(html(<Alert tone="danger" title="Failed" />)).toContain('role="alert"');
    expect(html(<Alert tone="info" title="FYI" />)).toContain('role="status"');
  });

  it("PageHeader renders a single h1 and breadcrumbs with the current page marked", () => {
    const out = html(<PageHeader title="Vehicles" breadcrumbs={[{ label: "Tracking", href: "/map" }, { label: "Vehicles" }]} />);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('aria-current="page"');
  });
});
