import { Link } from "react-router-dom";

interface Section {
  id: string;
  title: string;
  items: { q: string; a: string | React.ReactNode }[];
}

const sections: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    items: [
      {
        q: "What is AssetMinder?",
        a: "AssetMinder connects to your Jobber account and organises your job history by asset rather than date. Each client gets a shareable portal showing the full service history of every piece of equipment you maintain — technician, work notes, parts used, photos, and PDF reports. No login required for your clients.",
      },
      {
        q: "How do I connect AssetMinder to Jobber?",
        a: "Click Connect to Jobber on the home page. You'll be redirected to Jobber to approve the connection. Once approved, you'll land on the AssetMinder dashboard. The connection uses Jobber's secure OAuth — AssetMinder never sees your Jobber password.",
      },
      {
        q: "What data does AssetMinder pull from Jobber?",
        a: "AssetMinder syncs your clients, jobs, job custom fields, visit notes, line items, and photo attachments. It does not modify anything in Jobber — all reads are read-only.",
      },
      {
        q: "How do I trigger a sync?",
        a: "Use the Sync button in the top navigation bar on the dashboard. A full sync pulls all clients and jobs from Jobber and updates your local data. Syncs typically take 10–60 seconds depending on how many jobs you have.",
      },
    ],
  },
  {
    id: "asset-field",
    title: "Asset identification",
    items: [
      {
        q: "What is the asset grouping field?",
        a: "AssetMinder groups jobs by the value of a Jobber custom field on each job — for example a serial number or equipment ID. Whatever value is in that field becomes the asset identifier. All jobs with the same value are grouped under one asset.",
      },
      {
        q: "How does AssetMinder pick the field automatically?",
        a: "When you first connect, AssetMinder scans your existing Jobber custom field configurations for any Job field whose name contains \u201cserial\u201d, \u201casset\u201d, \u201cequipment\u201d, or \u201cid\u201d. If one is found it is selected automatically. If none are found, AssetMinder creates a new field called \u201cAsset ID\u201d in your Jobber account and uses that.",
      },
      {
        q: "How do I change which field is used?",
        a: "Go to Dashboard → Settings → Asset grouping field and click Change. You'll see a list of all custom fields configured on Jobs in your Jobber account. Select the one you want and click Save.",
      },
      {
        q: "What if no assets appear after a sync?",
        a: "Assets only appear if jobs have a value filled in for the asset grouping field. Check that your technicians are completing the field on jobs in Jobber, then run a sync. If the wrong field is selected, change it in Settings and re-sync.",
      },
    ],
  },
  {
    id: "client-portals",
    title: "Client portals",
    items: [
      {
        q: "What does a client portal show?",
        a: "Each portal shows all assets belonging to that client, along with the complete service history for each asset — job date, technician, work notes, line items (parts/labour), and any photos attached to job notes.",
      },
      {
        q: "How do I share a portal with a client?",
        a: "Find the client on your dashboard and click Share Portal. Copy the link and send it to your client by email, text, or however you prefer. The portal requires no login and works on any device.",
      },
      {
        q: "Is the portal link permanent?",
        a: "Yes. Once generated, the portal link stays the same for that client. You can share it again at any time from the dashboard.",
      },
      {
        q: "Can my client download a PDF service report?",
        a: "Yes. Each job in the portal has a Download PDF button that generates a branded service report with the asset ID, client name, technician, work notes, line items, and photos.",
      },
      {
        q: "Can I control which photos appear in reports?",
        a: "Yes. Open a job from the client or asset detail page, and you can toggle individual photos on or off. Excluded photos are hidden from the portal and PDF for that job.",
      },
    ],
  },
  {
    id: "service-due-dates",
    title: "Service due dates",
    items: [
      {
        q: "How are service due dates calculated?",
        a: "AssetMinder takes the date of the most recent completed job for an asset and adds the service interval (in days) to produce a next due date. The interval can be set at the client level or overridden per asset.",
      },
      {
        q: "How do I set a service interval?",
        a: "Open a client from the dashboard and set a default interval in days. To override for a specific asset, open the asset detail page and set the interval there.",
      },
      {
        q: "What are service keywords?",
        a: "By default, every completed job counts toward the service due date calculation. If you only want certain job types to count — for example \u201cAnnual Service\u201d or \u201cPM\u201d — add those keywords under Dashboard \u2192 Settings \u2192 Service keywords. Only jobs whose title contains one of the keywords will be used.",
      },
    ],
  },
  {
    id: "account",
    title: "Account & data",
    items: [
      {
        q: "How do I disconnect AssetMinder?",
        a: "Click Disconnect in the top right of the dashboard. This revokes AssetMinder's access to your Jobber account and permanently deletes all synced data. Client portal links will stop working immediately. This cannot be undone.",
      },
      {
        q: "What happens to my data if I disconnect?",
        a: "All data stored by AssetMinder — clients, jobs, assets, portal links — is permanently deleted. Your Jobber data is unaffected.",
      },
      {
        q: "How do I reconnect after disconnecting?",
        a: "Go back to the AssetMinder home page and click Connect to Jobber. You'll need to run a fresh sync to rebuild your asset data.",
      },
    ],
  },
];

export default function Help() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", backgroundColor: "#f8fafc" }} className="min-h-screen flex flex-col">

      <header style={{ backgroundColor: "#1e293b" }}>
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link to="/" className="text-white font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity">
            AssetMinder
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 flex-1 w-full">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">Support</p>
        <h1 className="text-3xl font-bold text-slate-800 tracking-tight mb-2">Help</h1>
        <p className="text-sm text-slate-400 mb-10">
          Common questions about AssetMinder. Can't find what you need?{" "}
          <a href="mailto:support@assetminder.com.au" className="text-slate-700 font-medium underline underline-offset-2 hover:text-slate-900">
            Email us
          </a>.
        </p>

        {/* Jump links */}
        <nav className="flex flex-wrap gap-2 mb-12">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
            >
              {s.title}
            </a>
          ))}
        </nav>

        <div className="space-y-14">
          {sections.map((section) => (
            <section key={section.id} id={section.id}>
              <h2 className="text-base font-semibold text-slate-800 mb-5 pb-3 border-b border-slate-200">
                {section.title}
              </h2>
              <div className="space-y-6">
                {section.items.map((item) => (
                  <div key={item.q}>
                    <p className="text-sm font-semibold text-slate-700 mb-1.5">{item.q}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
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
