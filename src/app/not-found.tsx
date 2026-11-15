import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, maxWidth: 420 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/logo-goat-256.png" alt="" width={88} height={88} style={{ borderRadius: "50%", boxShadow: "0 0 0 1px var(--line)" }} />
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: "-.01em" }}>Pukki couldn&rsquo;t find this page</h1>
        <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>It may have moved. Start from where you&rsquo;ll work instead.</p>
        <Link href="/move" style={{ marginTop: 6, padding: "10px 18px", borderRadius: 999, background: "var(--accent-deep)", color: "#fff", textDecoration: "none" }}>
          Find where to live
        </Link>
      </div>
    </main>
  );
}
