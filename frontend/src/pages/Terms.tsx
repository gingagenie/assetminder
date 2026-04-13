import { Link } from "react-router-dom";

export default function Terms() {
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
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Terms of Service</h1>
        <p className="text-sm text-slate-400 mb-10">Last updated: April 2026</p>

        <div className="space-y-8 text-sm text-slate-600 leading-relaxed">

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">1. Service Description</h2>
            <p>
              AssetMinder is a software service that connects to your Jobber account via the Jobber API. It synchronises your clients, jobs, and custom field data to group service history by asset, and generates shareable client portals displaying equipment service records. AssetMinder is an independent product and is not affiliated with, endorsed by, or officially connected to Jobber Inc.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">2. User Responsibilities</h2>
            <p className="mb-3">By using AssetMinder you agree to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Maintain an active and properly authorised Jobber account.</li>
              <li>Ensure the data in your Jobber account is accurate and up to date.</li>
              <li>Keep your Jobber OAuth connection active for AssetMinder to function correctly.</li>
              <li>Not use AssetMinder for any unlawful purpose or in violation of Jobber's own terms of service.</li>
              <li>Take responsibility for the content of client portals you share, including the accuracy of service records presented.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">3. Data Usage</h2>
            <p>
              AssetMinder stores a copy of your Jobber data — including client names, email addresses, job details, job status, custom field values, and visit notes — in a secure database hosted on Supabase. This data is used solely to power the AssetMinder dashboard, asset grouping, due date calculations, and client portal features. We do not sell your data or use it for advertising purposes.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">4. Subscription and Billing</h2>
            <p>
              Access to AssetMinder is provided through the Jobber Marketplace. Subscription fees, billing cycles, and payment processing are handled entirely by Jobber Inc. in accordance with their marketplace terms. AssetMinder does not directly collect payment information. Please refer to your Jobber subscription details for pricing information.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">5. Termination</h2>
            <p>
              You may terminate your use of AssetMinder at any time by disconnecting AssetMinder from your Jobber account via the Jobber Developer settings. Upon disconnection, your access to the AssetMinder dashboard and all client portals will be revoked. Stored data associated with your account will be deleted within 30 days of disconnection. We reserve the right to suspend or terminate access for accounts that violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">6. Limitation of Liability</h2>
            <p className="mb-3">
              AssetMinder is provided "as is" without warranties of any kind, express or implied. We do not guarantee uninterrupted availability of the service.
            </p>
            <p>
              To the maximum extent permitted by law, AssetMinder and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of data, loss of revenue, or loss of business, arising from your use of or inability to use the service. Our total liability to you for any claim arising from these terms or your use of AssetMinder shall not exceed the amount paid by you for the service in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">7. Changes to These Terms</h2>
            <p>
              We may update these Terms of Service from time to time. When we do, we will update the "Last updated" date at the top of this page. Continued use of AssetMinder after changes are posted constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">8. Governing Law</h2>
            <p>
              These Terms of Service are governed by and construed in accordance with the laws of the State of Victoria, Australia. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the courts of Victoria, Australia.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-slate-800 mb-3">9. Contact</h2>
            <p>
              If you have questions about these Terms of Service, please contact us at{" "}
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
        </p>
      </footer>

    </div>
  );
}
