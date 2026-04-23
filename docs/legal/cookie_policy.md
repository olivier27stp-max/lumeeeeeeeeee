# Cookie Policy — Lume CRM

**Version:** `cookie-policy-2026-04-21`
**Last updated:** 2026-04-21

> ⚠️ Template — must be validated by legal counsel before production.

## 1. What are cookies

Cookies are small text files stored on your device when you visit a website. Similar technologies include `localStorage`, `sessionStorage`, and pixel tags.

## 2. Categories we use

| Category | Purpose | Examples | Consent required? |
|---|---|---|---|
| **Strictly necessary** | Authentication, security, session maintenance, language routing | `sb-access-token`, `sb-refresh-token`, `lume-language` | No (legitimate necessity) |
| **Analytics** | Understand how the app is used (pages visited, errors, performance) | Not yet deployed | Yes — off by default |
| **Marketing** | Personalize communications, measure campaign effectiveness | Not yet deployed | Yes — off by default |
| **Preferences** | Remember your display choices | `lume.theme`, `lume.cookieConsent.v1` | Yes — off by default |

## 3. Your choices

On your first visit, a banner lets you accept all, reject all (as easily as accepting — Law 25 / CNIL guidance), or customize. You can change your choices at any time from `/account/privacy` → *Reset cookie preferences*.

We ask you again every **13 months** or when this policy changes materially.

## 4. Evidence of consent

When you are signed in, your consent choices are journaled in our `consents` database table (immutable entry with timestamp, IP address, user-agent and policy version) to demonstrate compliance. When you are anonymous, the choice is stored locally only.

## 5. Third-party cookies

We do not currently set third-party tracking cookies. When we use third-party scripts (Stripe Elements, Google Maps tiles), they may set their own session cookies — governed by their respective policies (see `/subprocessors`).

## 6. Contact

`willhebert30@gmail.com`
