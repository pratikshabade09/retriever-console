import Link from "next/link";
import { getClock, getState } from "@/lib/server/world";
import { doctorSummaries } from "@/lib/engine/projections";

// Avg wait and doctor availability change constantly — this must never be statically
// prerendered and served stale.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const doctors = doctorSummaries(getState(), getClock().now);

  return (
    <div className="site">
      <header className="site-header">
        <span className="site-logo">Retriever Clinic</span>
        <nav className="site-nav">
          <a href="#doctors">Our Doctors</a>
          <a href="#why-us">Why Us</a>
          <a href="#contact">Contact</a>
        </nav>
        <div className="site-header-spacer" />
        <div className="site-header-actions">
          <Link href="/login" className="btn-outline">
            Staff sign in
          </Link>
          <Link href="/patient/login" className="btn-outline">
            Patient login
          </Link>
          <Link href="/patient" className="btn-fill">
            Book now
          </Link>
        </div>
      </header>

      <section className="hero">
        <div className="hero-content">
          <h1>Care that keeps its word on time.</h1>
          <p>
            Book with the doctor you need, watch your likely OPD time update live, and skip the counter if you&apos;d rather pay ahead.
            Open Monday–Saturday.
          </p>
          <div className="hero-actions">
            <Link href="/patient" className="btn-fill">
              Book an appointment
            </Link>
          </div>
        </div>
      </section>

      <section className="section" id="why-us">
        <div className="section-title">Why patients choose us</div>
        <div className="section-sub">A clinic that tells you the truth about your wait, not just your appointment time.</div>
        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
            </div>
            <h3>Live likely OPD time</h3>
            <p>Your expected time updates as the queue actually moves — not a static booking slot.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="6" width="18" height="14" rx="2" />
                <path d="M3 10h18M8 3v4M16 3v4" />
              </svg>
            </div>
            <h3>Book in seconds</h3>
            <p>Pick a doctor or describe your symptom and we&apos;ll suggest one — then choose any open slot.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
              </svg>
            </div>
            <h3>Pay ahead, skip the counter</h3>
            <p>Prepaying only skips billing — your place in the clinical queue never changes.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 21v-7a8 8 0 0116 0v7" />
                <path d="M4 21h16M9 21v-4h6v4" />
              </svg>
            </div>
            <h3>Walk-ins welcome</h3>
            <p>Every doctor holds reserved capacity through the day for patients who couldn&apos;t book ahead.</p>
          </div>
        </div>
      </section>

      <section className="section" id="doctors">
        <div className="section-title">Our Doctors</div>
        <div className="section-sub">Available Monday–Saturday. Book directly, or let us suggest one based on your symptom.</div>
        <div className="doctor-showcase-grid">
          {doctors.map((d) => (
            <div key={d.id} className="doctor-showcase-card">
              <div className="doctor-showcase-avatar">{d.name.replace("Dr. ", "").slice(0, 1)}</div>
              <h3>{d.name}</h3>
              <div className="specialty">{d.specialty}</div>
              <div className="meta">
                {d.room} · Avg wait ~{d.avgWaitMinutes} min · ₹{d.consultationFee}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="site-cta">
        <h2>Ready to book?</h2>
        <p>Sign in or create a free patient account — it only takes a minute.</p>
        <div className="hero-actions">
          <Link href="/patient" className="btn-fill">
            Book an appointment
          </Link>
        </div>
      </div>

      <footer className="site-footer" id="contact">
        <div>Retriever Clinic · Open Monday–Saturday · General Physician, Cardiology, Dermatology</div>
        <div style={{ marginTop: 8 }}>
          <Link href="/patient/login">Patient login</Link> · <Link href="/track">Track an appointment</Link> · <Link href="/login">Staff sign in</Link>
        </div>
      </footer>
    </div>
  );
}
