# Paid tier — what still needs doing (branch paid-tier, not live)

Open decisions (Ryan + Priya): price, guarantee or not, session length, who runs sessions, booking tool.

Before launch:
1. Terms of Service and Privacy Policy: add paid-tier sections. Wording to be drafted/approved by the attorney,
   using ~/dispatch/benefighter/legal/draft_answers_2026-09-28.md. Topics: scope and exclusions (VA, tax, LTC),
   price and refunds, no guarantee of approval, what we collect for bookings (name, email, phone, call notes; never
   SSN or account numbers), payment processor, booking tool, retention, consent when a family member acts for a parent.
2. Stripe account in Parser LLC's name + payment link (Ryan).
3. Booking tool account (free tier) (Ryan).
4. check.js: point CHECKOUT_URL at book.html, update the offer text to the final price/wording, then SHOW_OFFER=true.
5. Attorney review (paid -> banker chat first).
