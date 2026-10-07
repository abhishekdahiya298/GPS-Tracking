import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { ContactLine, LegalPage } from "../legal";

export const metadata: Metadata = { title: `Terms of service · ${SITE.product}` };

export default function TermsPage() {
  const P = SITE.product;
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms apply to the use of {P}, provided by {SITE.company} (&quot;we&quot;). A signed order or quote may add to them; where the two differ, the signed document applies.
      </p>

      <h2>The service</h2>
      <p>{P} shows the position and history of vehicles fitted with compatible GPS trackers, with alerts, zones, reports and reminders. We may improve or change features over time.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep sign-in details private and give each person their own account.</li>
        <li>You are responsible for what people in your organization do with the service.</li>
        <li>Tell us promptly if you think an account has been misused.</li>
      </ul>

      <h2>Acceptable use</h2>
      <ul>
        <li>
          <strong>Track only what you have the right to track.</strong> Use {P} for vehicles and equipment you own or operate, and tell the people who drive them, as the law in your province or state requires. Tracking a person or vehicle without the legal right to do so is prohibited and may be a crime.
        </li>
        <li>Do not try to access another customer&apos;s data, disrupt the service or resell it without our written agreement.</li>
      </ul>

      <h2>What {P} is not</h2>
      <p>
        {P} is a fleet tracking tool. It is not a certified electronic logging device (ELD) and must not be used to meet hours-of-service rules. It is not an emergency or anti-theft recovery service. Positions depend on GPS and mobile coverage and can be late, missing or inaccurate; do not rely on them where safety is at stake.
      </p>

      <h2>Trackers and connectivity</h2>
      <p>Trackers, SIM cards and data plans are supplied as set out in your quote. You are responsible for correct installation unless we agreed to do it.</p>

      <h2>Fees</h2>
      <p>Fees, billing period and taxes are set out in your quote or order. Unpaid accounts may be suspended after notice.</p>

      <h2>Your data</h2>
      <p>
        You own your data. We use it only to provide the service, as described in our <Link href="/privacy">privacy policy</Link>. You can export reports at any time, and on request we will delete your data after your account closes.
      </p>

      <h2>Availability and liability</h2>
      <p>
        We work to keep {P} available but do not promise it will be uninterrupted or error-free. To the extent the law allows, the service is provided as is, we are not liable for indirect or consequential losses, and our total liability is limited to the fees you paid in the twelve months before the claim.
      </p>

      <h2>Ending the service</h2>
      <p>You can stop using {P} as set out in your quote. We may suspend or end an account that breaks these terms.</p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms and will tell account owners by email of changes that matter. Questions: <ContactLine />.
      </p>
    </LegalPage>
  );
}
