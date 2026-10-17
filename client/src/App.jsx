import { createContext, useContext, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowDownUp, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Clock3, Compass, CreditCard, LoaderCircle, LogOut, MapPin, Menu, Minus, Music2, Plus, Search, ShieldCheck, Sparkles, Ticket, Users, X } from "lucide-react";
import { useForm } from "react-hook-form";
import api, { messageFrom } from "./api.js";

const AuthContext = createContext(null);
const categories = ["All Events", "Music", "Tech", "Workshops", "Business"];
const money = (paise) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format((paise ?? 0) / 100);
const prettyDate = (date) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00`));

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem("gather-token")) {
      setReady(true);
      return;
    }
    api.get("/auth/me")
      .then(({ data }) => setUser(data.user))
      .catch(() => localStorage.removeItem("gather-token"))
      .finally(() => setReady(true));
  }, []);
  const signIn = (data) => {
    localStorage.setItem("gather-token", data.token);
    setUser(data.user);
  };
  const signOut = () => {
    localStorage.removeItem("gather-token");
    setUser(null);
  };
  return <AuthContext.Provider value={{ user, ready, signIn, signOut }}>{children}</AuthContext.Provider>;
}

const useAuth = () => useContext(AuthContext);

function Header() {
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="nav-wrap">
        <Link to="/" className="brand" aria-label="Gather home"><span className="brand-mark"><Sparkles size={19} /></span>gather<span className="brand-dot">.</span></Link>
        <button className="mobile-menu" aria-label="Toggle menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        <nav className={`nav-links ${menuOpen ? "nav-open" : ""}`}>
          <Link to="/" onClick={() => setMenuOpen(false)}>Events</Link>
          {user && <Link to="/bookings" onClick={() => setMenuOpen(false)}>My Bookings</Link>}
          {user && <Link to="/host" onClick={() => setMenuOpen(false)}>Become a Host</Link>}
          {user?.role === "ADMIN" && <Link to="/admin" onClick={() => setMenuOpen(false)}>Admin</Link>}
        </nav>
        <div className="nav-actions">
          {user ? <><Link className="profile-link" to="/bookings"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name.split(" ")[0]}</span></Link><button className="icon-btn logout-btn" aria-label="Log out" title="Log out" onClick={signOut}><LogOut size={18} /></button></> : <><Link className="login-link" to="/login">Log in</Link><Link className="btn btn-small btn-primary" to="/signup">Get started <ArrowRight size={15} /></Link></>}
        </div>
      </div>
    </header>
  );
}

function PrivateRoute({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function PageLoader() {
  return <div className="page-loader"><LoaderCircle className="spin" size={26} /><span>Loading Gather…</span></div>;
}

function EventCard({ event }) {
  const available = event.availableSeats > 0;
  return (
    <article className="event-card">
      <Link to={`/events/${event.id}`} className="event-image-wrap">
        <img src={event.bannerUrl} alt="" className="event-image" loading="lazy" />
        <span className="category-pill">{event.category}</span>
        {!available && <span className="sold-out">Sold out</span>}
      </Link>
      <div className="event-card-body">
        <div className="event-date-label"><CalendarDays size={15} /> {prettyDate(event.eventDate)} <span className="date-dot">·</span> {event.startTime}</div>
        <Link to={`/events/${event.id}`} className="event-title">{event.title}</Link>
        <div className="event-location"><MapPin size={15} /><span>{event.city}, {event.venue}</span></div>
        <div className="event-card-bottom"><div><span className="price-label">Tickets from</span><strong>{money(event.ticketPrice)}</strong></div><Link className="round-arrow" to={`/events/${event.id}`} aria-label={`Book ${event.title}`}><ArrowRight size={19} /></Link></div>
      </div>
    </article>
  );
}

function EventsPage() {
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All Events");
  const [sort, setSort] = useState("date");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      api.get("/events", { params: { q: query, category, sort } })
        .then(({ data }) => setEvents(data.events))
        .catch((err) => setError(messageFrom(err, "Unable to load events. Is the API running?")))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(timer);
  }, [query, category, sort]);
  return (
    <main>
      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow"><span className="eyebrow-icon"><Sparkles size={14} /></span> GOOD THINGS HAPPEN WHEN WE GATHER</div>
          <h1>Find your next<br /><span>great experience.</span></h1>
          <p>From big ideas to late-night encores, discover moments worth showing up for.</p>
          <div className="hero-search">
            <Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events, venues or cities" aria-label="Search events" />
            <button type="button" className="btn btn-primary search-button" onClick={() => document.getElementById("event-grid")?.scrollIntoView({ behavior: "smooth" })}>Explore <ArrowRight size={16} /></button>
          </div>
          <div className="hero-note"><span className="avatar-stack"><i>R</i><i>A</i><i>M</i></span> <span><strong>12k+</strong> people found their people</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-photo photo-one"><img src="https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=1000&q=85" alt="" /></div>
          <div className="hero-photo photo-two"><img src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=700&q=85" alt="" /></div>
          <div className="floating-note"><span><Music2 size={17} /></span><div><strong>Live a little.</strong><small>Make a memory.</small></div></div>
          <div className="hero-sparkle sparkle-a">✳</div><div className="hero-sparkle sparkle-b">✦</div>
        </div>
        <div className="hero-shape" />
      </section>
      <section className="events-section" id="event-grid">
        <div className="section-heading"><div><div className="eyebrow muted-eyebrow">YOUR NEXT STORY STARTS HERE</div><h2>Events worth <span>showing up for.</span></h2><p>Find your crowd. Find your thing. Make it a day to remember.</p></div><label className="sort-select"><ArrowDownUp size={16} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort events"><option value="date">Date: soonest</option><option value="price">Price: lowest</option></select><ChevronDown size={15} /></label></div>
        <div className="category-tabs" role="tablist" aria-label="Filter events">{categories.map((item) => <button key={item} role="tab" aria-selected={category === item} className={category === item ? "category-tab active" : "category-tab"} onClick={() => setCategory(item)}>{item}</button>)}</div>
        {error && <div className="notice error-notice">{error}</div>}
        {loading ? <div className="grid-loading"><PageLoader /></div> : events.length ? <div className="event-grid">{events.map((event) => <EventCard event={event} key={event.id} />)}</div> : <div className="empty-state"><span className="empty-icon"><Compass size={25} /></span><h3>No events found just yet</h3><p>Try a different search or category. Your next favorite thing is out there.</p><button className="btn btn-outline" onClick={() => { setQuery(""); setCategory("All Events"); }}>Clear filters</button></div>}
      </section>
      <section className="host-banner"><div className="host-copy"><div className="eyebrow">BRING PEOPLE TOGETHER</div><h2>Have an idea for<br />a great event?</h2><p>Make it happen. Create a gathering people will remember.</p><Link to="/host" className="btn btn-white">Become a host <ArrowRight size={16} /></Link></div><div className="host-visual"><div className="host-circle"><Users size={45} /></div><div className="host-mini-card"><span>✦</span><strong>Made for<br />good company.</strong></div></div></section>
      <Footer />
    </main>
  );
}

function EventDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [event, setEvent] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  useEffect(() => {
    api.get(`/events/${id}`).then(({ data }) => setEvent(data.event)).catch((err) => setError(messageFrom(err, "Event not found"))).finally(() => setLoading(false));
  }, [id]);
  async function book() {
    if (!user) return navigate("/login", { state: { from: { pathname: `/events/${id}` } } });
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/bookings", { eventId: id, ticketQuantity: quantity });
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setError(messageFrom(err));
      setBusy(false);
    }
  }
  if (loading) return <PageLoader />;
  if (!event) return <main className="narrow-page"><div className="notice error-notice">{error || "Event not found"}</div><Link to="/" className="text-link"><ArrowLeft size={16} /> Back to events</Link></main>;
  const maxQuantity = Math.min(10, event.availableSeats);
  const total = event.ticketPrice * quantity;
  return (
    <main className="detail-page">
      <Link to="/" className="back-link"><ArrowLeft size={16} /> All events</Link>
      {searchParams.get("checkout") === "cancelled" && <div className="notice info-notice">Checkout was cancelled. Your seats are held temporarily while you decide.</div>}
      <div className="detail-cover"><img src={event.bannerUrl} alt="" /><span className="category-pill">{event.category}</span></div>
      <div className="detail-layout">
        <article className="detail-main"><div className="eyebrow muted-eyebrow">{event.category.toUpperCase()} · {event.city.toUpperCase()}</div><h1>{event.title}</h1><p className="detail-lede">{event.description}</p><div className="detail-facts"><div className="fact"><span className="fact-icon"><CalendarDays size={19} /></span><div><small>DATE</small><strong>{prettyDate(event.eventDate)}</strong></div></div><div className="fact"><span className="fact-icon"><Clock3 size={19} /></span><div><small>STARTS AT</small><strong>{event.startTime}</strong></div></div><div className="fact"><span className="fact-icon"><MapPin size={19} /></span><div><small>LOCATION</small><strong>{event.venue}, {event.city}</strong></div></div></div><div className="about-event"><h2>About this event</h2><p>{event.description}</p></div></article>
        <aside className="booking-card"><div className="booking-top"><span className="booking-kicker">YOUR NIGHT OUT</span><strong className="booking-price">{money(event.ticketPrice)}<small> / ticket</small></strong><span className={`availability ${maxQuantity ? "" : "soldout-text"}`}><span />{maxQuantity ? `${event.availableSeats} tickets left` : "Sold out"}</span></div><div className="booking-divider" /><label className="quantity-label">Tickets <span>Up to 10 per booking</span></label><div className="quantity-control"><button aria-label="Remove one ticket" disabled={quantity <= 1} onClick={() => setQuantity((count) => Math.max(1, count - 1))}><Minus size={17} /></button><strong>{quantity}</strong><button aria-label="Add one ticket" disabled={quantity >= maxQuantity} onClick={() => setQuantity((count) => Math.min(maxQuantity, count + 1))}><Plus size={17} /></button></div><div className="total-row"><span>Total</span><strong>{money(total)}</strong></div>{error && <div className="form-error">{error}</div>}<button className="btn btn-primary book-button" disabled={!maxQuantity || busy} onClick={book}>{busy ? <><LoaderCircle className="spin" size={18} /> Opening secure checkout</> : <>Book your spot <ArrowRight size={17} /></>}</button><p className="secure-note"><ShieldCheck size={15} /> Secure checkout · Stripe test mode</p></aside>
      </div><Footer />
    </main>
  );
}

function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const { user, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  useEffect(() => { if (user) navigate("/", { replace: true }); }, [user, navigate]);
  async function submit(values) {
    setError("");
    setBusy(true);
    try {
      const { data } = await api.post(`/auth/${isSignup ? "signup" : "login"}`, values);
      signIn(data);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page"><div className="auth-art"><div className="auth-art-copy"><Link className="brand brand-light" to="/"><span className="brand-mark"><Sparkles size={19} /></span>gather<span className="brand-dot">.</span></Link><div><div className="eyebrow">MAKE ROOM FOR SOMETHING GOOD</div><h2>Life happens<br />when you show up.</h2><p>Find your people. Share a moment. Come back with a story.</p></div><div className="auth-art-bottom">✦ &nbsp; A little more together.</div></div></div><div className="auth-form-side"><div className="auth-form-wrap"><Link to="/" className="mobile-brand brand"><span className="brand-mark"><Sparkles size={18} /></span>gather<span className="brand-dot">.</span></Link><div className="eyebrow muted-eyebrow">{isSignup ? "YOUR NEXT CHAPTER" : "GOOD TO HAVE YOU BACK"}</div><h1>{isSignup ? "Create your account" : "Welcome back"}</h1><p className="auth-subtitle">{isSignup ? "Join a community that loves getting together." : "Log in to find your next great experience."}</p><form onSubmit={handleSubmit(submit)} className="auth-form">{isSignup && <FormField label="Full name" error={errors.name?.message}><input autoComplete="name" placeholder="Your name" {...register("name", { required: "Please enter your name", minLength: { value: 2, message: "Name must be at least 2 characters" } })} /></FormField>}<FormField label="Email address" error={errors.email?.message}><input type="email" autoComplete="email" placeholder="you@example.com" {...register("email", { required: "Please enter your email", pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email address" } })} /></FormField><FormField label="Password" error={errors.password?.message}><input type="password" autoComplete={isSignup ? "new-password" : "current-password"} placeholder={isSignup ? "At least 8 characters" : "Enter your password"} {...register("password", { required: "Please enter your password", minLength: isSignup ? { value: 8, message: "Use at least 8 characters" } : undefined })} /></FormField>{isSignup && <FormField label="Confirm password" error={errors.confirmPassword?.message}><input type="password" autoComplete="new-password" placeholder="Type your password again" {...register("confirmPassword", { required: "Please confirm your password", validate: (value) => value === watch("password") || "Passwords don't match" })} /></FormField>}{error && <div className="notice error-notice">{error}</div>}<button className="btn btn-primary auth-submit" disabled={busy}>{busy ? <><LoaderCircle size={18} className="spin" /> Please wait</> : <>{isSignup ? "Create account" : "Log in"} <ArrowRight size={17} /></>}</button></form><p className="auth-switch">{isSignup ? "Already have an account?" : "New to Gather?"} <Link to={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</Link></p><p className="auth-legal">By continuing, you agree to our <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</p></div></div></main>
  );
}

function FormField({ label, error, children }) {
  return <label className="form-field"><span>{label}</span>{children}{error && <small className="field-error">{error}</small>}</label>;
}

function BookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resuming, setResuming] = useState("");
  useEffect(() => { api.get("/bookings/my").then(({ data }) => setBookings(data.bookings)).catch((err) => setError(messageFrom(err))).finally(() => setLoading(false)); }, []);
  async function resumeCheckout(bookingId) {
    setResuming(bookingId);
    setError("");
    try {
      const { data } = await api.post(`/bookings/${bookingId}/checkout`, {});
      window.location.assign(data.checkoutUrl);
    } catch (err) {
      setError(messageFrom(err));
      setResuming("");
    }
  }
  return <main className="content-page"><div className="eyebrow muted-eyebrow">YOUR GATHERINGS</div><h1 className="page-title">My bookings</h1><p className="page-intro">Your plans, all in one place.</p>{loading ? <PageLoader /> : error && !bookings.length ? <div className="notice error-notice">{error}</div> : bookings.length ? <>{error && <div className="notice error-notice">{error}</div>}<div className="booking-list">{bookings.map((booking) => <article className="booking-row" key={booking.id}><img src={booking.bannerUrl} alt="" /><div className="booking-row-info"><div className="event-date-label"><CalendarDays size={14} /> {prettyDate(booking.eventDate)}</div><h2>{booking.eventTitle}</h2><span><MapPin size={14} /> {booking.city}, {booking.venue}</span><small>Booking ID: {booking.id.slice(0, 8).toUpperCase()} · {booking.ticketQuantity} ticket{booking.ticketQuantity !== 1 ? "s" : ""}</small></div><div className="booking-row-end"><strong>{money(booking.totalAmount)}</strong><StatusBadge status={booking.paymentStatus} /><span>{booking.bookingStatus}</span>{booking.bookingStatus === "PENDING" && <button className="btn btn-outline btn-small resume-button" disabled={Boolean(resuming)} onClick={() => resumeCheckout(booking.id)}>{resuming === booking.id ? <><LoaderCircle size={14} className="spin" /> Opening</> : "Continue checkout"}</button>}</div></article>)}</div></> : <div className="empty-state"><span className="empty-icon"><Ticket size={25} /></span><h3>Your next great story is waiting</h3><p>You haven't booked any events yet. Let's find something worth showing up for.</p><Link to="/" className="btn btn-primary">Explore events <ArrowRight size={16} /></Link></div>}<Footer /></main>;
}

function StatusBadge({ status }) {
  const label = status === "PAID" ? "Paid" : status === "PENDING" ? "Awaiting payment" : status === "FAILED" ? "Payment failed" : "Cancelled";
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status === "PAID" && <Check size={13} />}{label}</span>;
}

function ConfirmationPage() {
  const [searchParams] = useSearchParams();
  const bookingId = searchParams.get("bookingId");
  const [booking, setBooking] = useState(null);
  const [paymentStatus, setPaymentStatus] = useState("PENDING");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!bookingId) {
      setError("This confirmation link is missing a booking ID.");
      setLoading(false);
      return undefined;
    }
    let active = true;
    let timer;
    const check = async () => {
      try {
        const [{ data: bookingData }, { data: statusData }] = await Promise.all([
          api.get(`/bookings/${bookingId}`),
          api.get(`/payments/${bookingId}/status`),
        ]);
        if (!active) return;
        setBooking(bookingData.booking);
        setPaymentStatus(statusData.paymentStatus);
        setError("");
        if (statusData.paymentStatus === "PENDING" && statusData.bookingStatus === "PENDING") timer = setTimeout(check, 4000);
      } catch (err) {
        if (active) setError(messageFrom(err, "Unable to verify this booking"));
      } finally {
        if (active) setLoading(false);
      }
    };
    check();
    return () => { active = false; clearTimeout(timer); };
  }, [bookingId]);
  if (loading) return <PageLoader />;
  return <main className="confirmation-page">{error ? <div className="confirmation-card"><span className="confirm-icon confirm-wait"><ShieldCheck size={29} /></span><h1>We couldn't verify this booking</h1><p>{error}</p><Link className="btn btn-primary" to="/">Browse events</Link></div> : <div className="confirmation-card"><span className={`confirm-icon ${paymentStatus === "PAID" ? "confirm-success" : "confirm-wait"}`}>{paymentStatus === "PAID" ? <Check size={31} /> : <LoaderCircle size={29} className={paymentStatus === "PENDING" ? "spin" : ""} />}</span><div className="eyebrow muted-eyebrow">{paymentStatus === "PAID" ? "IT'S OFFICIAL" : "PAYMENT UPDATE"}</div><h1>{paymentStatus === "PAID" ? "You're on the list!" : paymentStatus === "PENDING" ? "Confirming your spot…" : "Your booking wasn't completed"}</h1><p>{paymentStatus === "PAID" ? "Payment confirmed. Your next great experience is waiting." : paymentStatus === "PENDING" ? "We are waiting for the secure payment confirmation from Stripe. This page will update automatically." : "No payment was recorded for this booking. You can browse events and try again."}</p>{booking && <div className="confirmation-details"><strong>{booking.eventTitle}</strong><span>{booking.ticketQuantity} ticket{booking.ticketQuantity !== 1 ? "s" : ""} · {prettyDate(booking.eventDate)}</span><span>Booking ID: {booking.id.slice(0, 8).toUpperCase()}</span><StatusBadge status={paymentStatus} /></div>}<div className="confirmation-actions">{paymentStatus === "PAID" ? <Link className="btn btn-primary" to="/bookings">View my bookings <ArrowRight size={16} /></Link> : <Link className="btn btn-outline" to="/">Explore events <ArrowRight size={16} /></Link>}</div><p className="confirmation-trust"><ShieldCheck size={15} /> Payment status verified securely by Gather</p></div>}<Footer /></main>;
}

function HostPage() {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { category: "Music", ticketPrice: "", totalSeats: "", bannerUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1400&q=85" } });
  async function submit(values) {
    setBusy(true); setError(""); setSuccess("");
    try {
      await api.post("/events", { ...values, ticketPrice: Math.round(Number(values.ticketPrice) * 100), totalSeats: Number(values.totalSeats) });
      setSuccess("Your event has been submitted for admin approval.");
      setTimeout(() => navigate("/"), 1800);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }
  return <main className="content-page host-page"><div className="eyebrow muted-eyebrow">MAKE IT HAPPEN</div><h1 className="page-title">Host an event</h1><p className="page-intro">Create a space for people to connect around something they love.</p><div className="host-form-card"><div className="approval-note"><ShieldCheck size={18} /><span>Events are reviewed by our team before appearing publicly.</span></div><form className="host-form" onSubmit={handleSubmit(submit)}><FormField label="Event name" error={errors.title?.message}><input placeholder="e.g. Friday Night Live" {...register("title", { required: "Please enter an event name", minLength: 3 })} /></FormField><FormField label="Category" error={errors.category?.message}><select {...register("category", { required: true })}><option>Music</option><option>Tech</option><option>Workshops</option><option>Business</option></select></FormField><FormField label="Description" error={errors.description?.message}><textarea rows="4" placeholder="What makes this event special?" {...register("description", { required: true, minLength: { value: 20, message: "Please add a little more detail" } })} /></FormField><FormField label="Banner image URL" error={errors.bannerUrl?.message}><input type="url" {...register("bannerUrl", { required: true })} /></FormField><div className="form-two-cols"><FormField label="Date" error={errors.eventDate?.message}><input type="date" min={new Date().toISOString().slice(0, 10)} {...register("eventDate", { required: true })} /></FormField><FormField label="Start time" error={errors.startTime?.message}><input type="time" {...register("startTime", { required: true })} /></FormField></div><div className="form-two-cols"><FormField label="Venue" error={errors.venue?.message}><input placeholder="Venue name" {...register("venue", { required: true })} /></FormField><FormField label="City" error={errors.city?.message}><input placeholder="City" {...register("city", { required: true })} /></FormField></div><div className="form-two-cols"><FormField label="Ticket price (₹)" error={errors.ticketPrice?.message}><input type="number" min="0" step="1" {...register("ticketPrice", { required: true, min: 0 })} /></FormField><FormField label="Total tickets" error={errors.totalSeats?.message}><input type="number" min="1" {...register("totalSeats", { required: true, min: 1 })} /></FormField></div>{error && <div className="notice error-notice">{error}</div>}{success && <div className="notice success-notice"><Check size={16} /> {success}</div>}<button className="btn btn-primary" disabled={busy}>{busy ? <><LoaderCircle size={17} className="spin" /> Submitting</> : <>Submit for approval <ArrowRight size={16} /></>}</button></form></div><Footer /></main>;
}

function AdminPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [adminBookings, setAdminBookings] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    Promise.all([api.get("/admin/summary"), api.get("/admin/bookings")])
      .then(([summaryResponse, bookingsResponse]) => {
        setSummary(summaryResponse.data);
        setAdminBookings(bookingsResponse.data.bookings);
        setDrafts(Object.fromEntries(summaryResponse.data.events.map((event) => [
          event.id,
          { title: event.title, ticketPrice: String(event.ticketPrice / 100), totalSeats: String(event.totalSeats) },
        ])));
      })
      .catch((err) => setError(messageFrom(err)));
  }, [reload]);
  async function review(id, status) {
    setBusyId(id); setError("");
    try {
      await api.put(`/events/${id}`, { status });
      setReload((value) => value + 1);
    } catch (err) { setError(messageFrom(err)); }
    finally { setBusyId(""); }
  }
  async function saveEvent(event) {
    const draft = drafts[event.id];
    setBusyId(event.id); setError("");
    try {
      await api.put(`/events/${event.id}`, {
        title: draft.title,
        ticketPrice: Math.round(Number(draft.ticketPrice) * 100),
        totalSeats: Number(draft.totalSeats),
      });
      setReload((value) => value + 1);
    } catch (err) { setError(messageFrom(err)); }
    finally { setBusyId(""); }
  }
  async function deleteEvent(id) {
    if (!window.confirm("Delete this event? Events with booking history cannot be deleted.")) return;
    setBusyId(id); setError("");
    try {
      await api.delete(`/events/${id}`);
      setReload((value) => value + 1);
    } catch (err) { setError(messageFrom(err)); }
    finally { setBusyId(""); }
  }
  async function cancelBooking(id) {
    if (!window.confirm("Cancel this pending booking and release its tickets?")) return;
    setBusyId(id); setError("");
    try {
      await api.post(`/admin/bookings/${id}/cancel`);
      setReload((value) => value + 1);
    } catch (err) { setError(messageFrom(err)); }
    finally { setBusyId(""); }
  }
  if (user?.role !== "ADMIN") return <main className="content-page"><div className="notice error-notice">Administrator access is required.</div></main>;
  return <main className="content-page">
    <div className="eyebrow muted-eyebrow">GATHER CONTROL ROOM</div><h1 className="page-title">Admin dashboard</h1><p className="page-intro">A pulse check on your community.</p>
    {error && <div className="notice error-notice admin-error">{error}</div>}
    {!summary ? <PageLoader /> : <>
      <div className="stats-grid">{[["Users", summary.stats.users, <Users />], ["Events", summary.stats.events, <CalendarDays />], ["Bookings", summary.stats.bookings, <Ticket />], ["Revenue", money(summary.stats.revenue), <CreditCard />]].map(([label, value, icon]) => <div className="stat-card" key={label}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>)}</div>
      <section className="admin-section">
        <div className="admin-heading"><div><div className="eyebrow muted-eyebrow">NEEDS YOUR EYES</div><h2>Pending events <span className="count-pill">{summary.stats.pending_events}</span></h2></div><Link to="/host" className="btn btn-outline btn-small">Create an event <Plus size={15} /></Link></div>
        {summary.pendingEvents.length ? <div className="admin-event-list">{summary.pendingEvents.map((event) => <article className="admin-event" key={event.id}><img src={event.bannerUrl} alt="" /><div><span className="event-date-label">{event.category} · {prettyDate(event.eventDate)}</span><h3>{event.title}</h3><p>{event.city} · {money(event.ticketPrice)}</p></div><div className="admin-event-actions"><button className="btn btn-outline btn-small" disabled={busyId === event.id} onClick={() => review(event.id, "REJECTED")}>Reject</button><button className="btn btn-primary btn-small" disabled={busyId === event.id} onClick={() => review(event.id, "PUBLISHED")}>{busyId === event.id ? "Saving…" : "Approve"}</button></div></article>)}</div> : <div className="empty-inline"><Check size={17} /> You're all caught up. No pending events.</div>}
      </section>
      <section className="admin-section">
        <div className="admin-heading"><div><div className="eyebrow muted-eyebrow">EVENT CATALOG</div><h2>Manage events <span className="count-pill">{summary.events.length}</span></h2></div></div>
        <div className="manage-events">{summary.events.map((event) => {
          const draft = drafts[event.id] ?? { title: event.title, ticketPrice: String(event.ticketPrice / 100), totalSeats: String(event.totalSeats) };
          return <article className="manage-event" key={event.id}>
            <div className="manage-event-heading"><div><span className={`event-status status-${event.status.toLowerCase()}`}>{event.status}</span><span className="event-date-label">{event.category} · {event.city}</span><h3>{event.title}</h3></div><button className="btn btn-outline btn-small delete-event" disabled={busyId === event.id} onClick={() => deleteEvent(event.id)}>Delete</button></div>
            <div className="manage-event-fields">
              <FormField label="Event title"><input value={draft.title} onChange={(eventChange) => setDrafts((current) => ({ ...current, [event.id]: { ...draft, title: eventChange.target.value } }))} /></FormField>
              <FormField label="Ticket price (₹)"><input type="number" min="0" step="1" value={draft.ticketPrice} onChange={(eventChange) => setDrafts((current) => ({ ...current, [event.id]: { ...draft, ticketPrice: eventChange.target.value } }))} /></FormField>
              <FormField label="Total seats"><input type="number" min="1" value={draft.totalSeats} onChange={(eventChange) => setDrafts((current) => ({ ...current, [event.id]: { ...draft, totalSeats: eventChange.target.value } }))} /></FormField>
              <button className="btn btn-primary btn-small" disabled={busyId === event.id} onClick={() => saveEvent(event)}>{busyId === event.id ? "Saving…" : "Save changes"}</button>
            </div>
            <small className="availability-caption">{event.availableSeats} of {event.totalSeats} tickets currently available. Capacity cannot be set below reserved tickets.</small>
          </article>;
        })}</div>
      </section>
      <section className="admin-section">
        <div className="admin-heading"><div><div className="eyebrow muted-eyebrow">PAYMENT ACTIVITY</div><h2>Recent bookings <span className="count-pill">{adminBookings.length}</span></h2></div></div>
        {adminBookings.length ? <div className="admin-bookings">{adminBookings.map((booking) => <article className="admin-booking" key={booking.id}>
          <div className="admin-booking-main"><strong>{booking.event_title}</strong><span>{booking.user_name} · {booking.user_email}</span><small>{booking.id.slice(0, 8).toUpperCase()} · {booking.ticket_quantity} ticket{booking.ticket_quantity !== 1 ? "s" : ""} · {prettyDate(booking.created_at.slice(0, 10))}</small></div>
          <div className="admin-booking-payment"><strong>{money(booking.total_amount)}</strong><StatusBadge status={booking.payment_status} /><small>{booking.payment_record_status ? `Payment: ${booking.payment_record_status}` : "Checkout not started"}</small></div>
          {booking.booking_status === "PENDING" && <button className="btn btn-outline btn-small cancel-booking" disabled={busyId === booking.id} onClick={() => cancelBooking(booking.id)}>{busyId === booking.id ? "Cancelling…" : "Cancel & release"}</button>}
        </article>)}</div> : <div className="empty-inline">No bookings yet.</div>}
      </section>
    </>}
    <Footer />
  </main>;
}

function Footer() {
  return <footer className="site-footer"><Link to="/" className="brand"><span className="brand-mark"><Sparkles size={17} /></span>gather<span className="brand-dot">.</span></Link><span>Made for good company. <span>© 2026 Gather</span></span><a href="mailto:hello@gather.example">Say hello <ArrowRight size={14} /></a></footer>;
}

function NotFound() {
  return <main className="content-page"><div className="empty-state"><span className="empty-icon"><Compass size={25} /></span><h3>That page wandered off</h3><p>Let's get you back to the good stuff.</p><Link to="/" className="btn btn-primary">Back to events</Link></div></main>;
}

export default function App() {
  return <AuthProvider><Header /><Routes><Route path="/" element={<EventsPage />} /><Route path="/events/:id" element={<EventDetailsPage />} /><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/signup" element={<AuthPage mode="signup" />} /><Route path="/bookings" element={<PrivateRoute><BookingsPage /></PrivateRoute>} /><Route path="/host" element={<PrivateRoute><HostPage /></PrivateRoute>} /><Route path="/admin" element={<PrivateRoute><AdminPage /></PrivateRoute>} /><Route path="/booking/confirmation" element={<PrivateRoute><ConfirmationPage /></PrivateRoute>} /><Route path="*" element={<NotFound />} /></Routes></AuthProvider>;
}
