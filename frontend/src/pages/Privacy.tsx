import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen flex flex-col">

      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link to="/" className="text-white font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity">
            AssetMinder
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 flex-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Legal</p>
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Privacy Policy</h1>
        <p className="text-sm text-slate-400 mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-sm text-slate-600 leading-relaxed">

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">1. Overview</h2>
            <p>
              AssetMinder ("we", "us", "our") is committed to protecting your privacy. This Privacy Policy explains what data we collect, how we use it, and your rights in relation to it. AssetMinder operates in compliance with the Australian Privacy Act 1988 (Cth) and, where applicable, the EU General Data Protection Regulation (GDPR).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">2. Data We Collect</h2>
            <p className="mb-3">When you connect AssetMinder to your Jobber account, we retrieve and store the following data via the Jobber API:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-slate-700">Account data:</span> Your Jobber account ID and OAuth access credentials (encrypted).</li>
              <li><span className="font-medium text-slate-700">Client data:</span> Client names, company names, and email addresses.</li>
              <li><span className="font-medium text-slate-700">Job data:</span> Job numbers, titles, statuses, creation and completion dates, technician assignments, and visit notes.</li>
              <li><span className="font-medium text-slate-700">Custom field data:</span> The values of custom fields attached to jobs, including asset identifiers such as serial numbers.</li>
            </ul>
            <p className="mt-3">We do not collect payment information, passwords, or any data beyond what is provided by the Jobber API.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">3. How We Use Your Data</h2>
            <p className="mb-3">Data collected is used exclusively to provide the AssetMinder service:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Grouping job history by asset identifier to build equipment service records.</li>
              <li>Calculating service intervals and next due dates.</li>
              <li>Generating client-facing portals that display asset service history.</li>
              <li>Producing service report PDFs on request.</li>
            </ul>
            <p className="mt-3">We do not use your data for advertising, profiling, or any purpose unrelated to operating the service.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">4. Data Storage</h2>
            <p>
              All data is stored in a PostgreSQL database provided by Supabase, with servers located in the United States. The AssetMinder application is hosted on Render, also in the United States. By using AssetMinder, you consent to your data being transferred to and stored in the United States. We implement reasonable technical and organisational measures to protect your data against unauthorised access, loss, or disclosure.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">5. Third Parties</h2>
            <p className="mb-3">AssetMinder shares data with the following third-party services solely to operate the product:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><span className="font-medium text-slate-700">Jobber Inc.</span> — We access your Jobber data via their API under your authorisation. Jobber's own privacy policy governs data held within the Jobber platform.</li>
              <li><span className="font-medium text-slate-700">Supabase</span> — Our database provider. Data is encrypted at rest.</li>
              <li><span className="font-medium text-slate-700">Render</span> — Our application hosting provider. Network traffic is encrypted in transit via TLS.</li>
            </ul>
            <p className="mt-3">We do not sell, rent, or share your data with any other third parties.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">6. Data Retention</h2>
            <p>
              Your data is retained for as long as your AssetMinder account is active. If you disconnect AssetMinder from your Jobber account, your data will be permanently deleted from our systems within 30 days. You may also request immediate deletion by contacting us at the address below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">7. Your Rights</h2>
            <p className="mb-3">Depending on your location, you may have the following rights regarding your personal data:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>The right to access the personal data we hold about you.</li>
              <li>The right to request correction of inaccurate data.</li>
              <li>The right to request deletion of your data.</li>
              <li>The right to object to or restrict processing of your data.</li>
              <li>The right to data portability (GDPR).</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, please contact us at the address below. We will respond within 30 days.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">8. Cookies</h2>
            <p>
              AssetMinder does not use cookies. Session information (your Jobber account ID) is stored in your browser's local storage solely to keep you logged in between visits.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. When we do, we will update the "Last updated" date at the top of this page. We encourage you to review this page periodically. Continued use of AssetMinder after changes are posted constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">10. Contact</h2>
            <p>
              For privacy-related questions, data access requests, or deletion requests, please contact us at{" "}
              <a href="mailto:support@assetminder.com.au" className="text-slate-800 font-medium underline underline-offset-2">
                support@assetminder.com.au
              </a>.
            </p>
          </section>

        </div>
      </main>

      <footer className="border-t border-slate-200 py-6 mt-8">
        <p className="text-center text-xs text-slate-400">
          AssetMinder ·{" "}
          <Link to="/terms" className="hover:text-slate-600 transition-colors">Terms of Service</Link>
          {" · "}
          <Link to="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</Link>
          {" · "}
          <Link to="/help" className="hover:text-slate-600 transition-colors">Help</Link>
        </p>
      </footer>

    </div>
  );
}
