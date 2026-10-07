import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { ContactLine, LegalPage } from "../legal";

export const metadata: Metadata = { title: `Privacy policy · ${SITE.product}` };

export default function PrivacyPage() {
  const P = SITE.product;
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what information {SITE.company} (&quot;we&quot;) handles when you use {P}, why, and the choices you have. It covers this website and the {P} service.
      </p>

      <h2>Who is responsible</h2>
      <p>
        Our customers are businesses that track their own vehicles. The customer decides which vehicles are tracked and who in their company can see them; we process that information on the customer&apos;s behalf to provide the service. If you are a driver or employee of a customer, your employer is your first point of contact about how tracking is used.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account details:</strong> name, work email, role and company, and a password stored only in hashed form.
        </li>
        <li>
          <strong>Vehicle and location data:</strong> position, speed, direction, ignition state and time reported by the GPS trackers a customer installs, plus the vehicle names, plates and groups the customer enters.
        </li>
        <li>
          <strong>Activity records:</strong> sign-ins and changes made in the account (an audit log), kept for security.
        </li>
        <li>
          <strong>Pricing requests:</strong> the name, company, email, phone, fleet size and message you send through our form.
        </li>
        <li>
          <strong>Technical data:</strong> IP address and browser type in server logs, used to keep the service secure and working.
        </li>
      </ul>
      <p>We do not sell personal information, and we do not use advertising trackers on this site.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To show a customer where their vehicles are and where they have been, and to produce the alerts and reports they set up.</li>
        <li>To send service email such as alerts, scheduled reports, invitations and password resets.</li>
        <li>To reply to pricing requests.</li>
        <li>To secure the service, investigate problems and meet legal obligations.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>
        Only with service providers that help us run {P}, under contract and only for that purpose: hosting, email delivery and map tiles. Map tiles are requested by your browser from the map provider, which sees your IP address and the area of the map you view but not your vehicles&apos; identities. We disclose information when the law requires it.
      </p>
      <p>A customer can create a temporary link that shows one vehicle&apos;s live position to anyone who has the link. That is the customer&apos;s choice and they can turn it off at any time.</p>

      <h2>Where it is kept and for how long</h2>
      <p>
        Data is stored on servers in North America and may be processed in Canada and the United States. We keep account and vehicle data for as long as the customer&apos;s account is active, and delete or return it after the account closes unless the law requires us to keep it. Pricing requests are kept for up to 24 months.
      </p>

      <h2>Security</h2>
      <p>Connections are encrypted, each customer&apos;s data is separated from every other customer&apos;s, access is limited by role, and changes are logged. No system is perfectly secure; if a breach affects your information we will notify the affected customer and the regulators as the law requires.</p>

      <h2>Your choices and rights</h2>
      <p>
        Depending on where you live (for example under Canada&apos;s PIPEDA, Quebec&apos;s Law 25 or US state privacy laws), you may have the right to see, correct or delete your personal information, or to complain to a privacy regulator. If your information is in a customer&apos;s account, ask that customer first; we will help them respond. For anything else, reach our privacy contact through <ContactLine />.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will update the date above and tell account owners by email.</p>
    </LegalPage>
  );
}
