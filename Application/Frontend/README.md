# DARAS — Frontend

**Driver Attention and Risk Assessment System** · Web Interface

The DARAS frontend is a [Next.js 16](https://nextjs.org/) application that provides the web-based portals for both **drivers** and **employers** in the DARAS ecosystem. It communicates exclusively with the real DARAS backend API — all former mock/placeholder backend files have been removed.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Pages & Routes](#pages--routes)
- [API Integration](#api-integration)
- [Getting Started](#getting-started)
- [Environment & Configuration](#environment--configuration)
- [Contributing (Frontend Team)](#contributing-frontend-team)

---

## Project Overview

DARAS is an AI-powered fleet safety platform. The frontend serves two distinct user types through separate, authenticated portals:

| Portal | Who it's for | What it shows |
|---|---|---|
| **Driver** | Individual drivers | Personal trips, safety scores, calibration, analytics |
| **Employer** | Fleet managers / companies | Fleet-wide rankings, risk reports, device management |

The landing page (`/`) lets users self-select their portal and serves as a public marketing surface for the platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Icons | Lucide React |
| Fonts | Plus Jakarta Sans, Sora (via Google Fonts) |
| Notifications | Custom Toast context (no external lib) |
| Support form | Formspree (via Next.js API route) |
| Auth storage | `localStorage` / `sessionStorage` tokens |

---

## Project Structure

```
Application/Frontend/
├── public/                        # Static assets (SVGs, favicon)
├── src/
│   ├── app/
│   │   ├── page.tsx               # Landing page — portal selector
│   │   ├── layout.tsx             # Root layout (fonts, metadata, ToastProvider)
│   │   ├── globals.css            # Global Tailwind + custom styles
│   │   ├── error.tsx              # Global error boundary
│   │   ├── not-found.tsx          # 404 page
│   │   │
│   │   ├── components/            # Shared UI components
│   │   │   ├── floating-nav.tsx   # Sticky top navigation bar
│   │   │   ├── neural-net-canvas.tsx  # Animated background canvas
│   │   │   └── toast-context.tsx  # Toast notification system
│   │   │
│   │   ├── driver/                # Driver portal
│   │   │   ├── page.tsx           # Login / Register page
│   │   │   ├── driver-login-form.tsx
│   │   │   ├── driver-register-form.tsx
│   │   │   └── dashboard/
│   │   │       ├── page.tsx       # Driver dashboard (trips, scores, analytics)
│   │   │       ├── driver-analytics.tsx
│   │   │       └── calibration/
│   │   │           └── page.tsx   # Device calibration flow
│   │   │
│   │   ├── employer/              # Employer portal
│   │   │   ├── page.tsx           # Login page
│   │   │   ├── employer-login-form.tsx
│   │   │   ├── employer-header.tsx
│   │   │   ├── employer-session.ts
│   │   │   ├── enterprise/
│   │   │   │   ├── page.tsx
│   │   │   │   └── enterprise-register-form.tsx
│   │   │   ├── individual/
│   │   │   │   ├── page.tsx
│   │   │   │   └── individual-register-form.tsx
│   │   │   └── dashboard/
│   │   │       ├── page.tsx
│   │   │       ├── employer-dashboard-shell.tsx
│   │   │       ├── employer-dashboard-summary.tsx
│   │   │       ├── employee-ranking.tsx
│   │   │       ├── driver-analysis-modal.tsx
│   │   │       ├── device-management.tsx
│   │   │       ├── live-alerts.tsx
│   │   │       ├── reports/
│   │   │       │   └── page.tsx   # Exportable fleet reports
│   │   │       └── settings/
│   │   │           └── page.tsx   # Account settings
│   │   │
│   │   ├── api/
│   │   │   └── support/
│   │   │       └── route.ts       # Next.js API route → Formspree
│   │   │
│   │   ├── about/page.tsx
│   │   ├── faq/page.tsx
│   │   ├── support/page.tsx
│   │   └── privacy/page.tsx
│   │
│   ├── lib/
│   │   ├── api-config.ts          # All backend endpoint URLs + auth helpers
│   │   └── countries.ts           # Country list helper
│   │
│   └── data/
│       └── countries.json         # Country names dataset
│
├── next.config.ts                 # Next.js configuration
├── tsconfig.json
├── eslint.config.mjs
├── postcss.config.mjs
└── package.json
```

---

## Pages & Routes

### Public pages

| Route | Description |
|---|---|
| `/` | Landing page — hero, feature grid, portal selector |
| `/about` | About DARAS |
| `/faq` | Frequently asked questions |
| `/support` | Contact / support form |
| `/privacy` | Privacy policy |

### Driver portal

| Route | Description |
|---|---|
| `/driver` | Driver login & registration |
| `/driver/dashboard` | Personal dashboard — trip history, safety score, analytics |
| `/driver/dashboard/calibration` | Raspberry Pi device calibration wizard |

### Employer portal

| Route | Description |
|---|---|
| `/employer` | Employer login |
| `/employer/enterprise` | Enterprise (company) registration |
| `/employer/individual` | Individual employer registration |
| `/employer/dashboard` | Fleet overview — rankings, alerts, summary |
| `/employer/dashboard/reports` | Exportable fleet safety reports |
| `/employer/dashboard/settings` | Account settings |

### API routes (server-side)

| Route | Description |
|---|---|
| `POST /api/support` | Forwards support form submissions to Formspree |

---

## API Integration

All backend communication is configured in [`src/lib/api-config.ts`](src/lib/api-config.ts).

The file exports:

- **`API_BASE_URL`** — base URL of the DARAS backend
- **`API_ENDPOINTS`** — typed map of every endpoint used by the frontend
- **`COMMON_HEADERS`** — headers required by the backend (e.g. `ngrok-skip-browser-warning`)
- **`getEmployerAuthToken()`** — reads the employer JWT from `localStorage`
- **`getDriverAuthToken()`** — reads the driver JWT from `localStorage`
- **`getEmployerId()`** — resolves the employer ID from session/local storage

When the backend URL changes (e.g. new deployment, new ngrok tunnel), **only `api-config.ts` needs to be updated**.

### Key endpoints

| Constant | Purpose |
|---|---|
| `LOGIN` | Employer login |
| `EMPLOYERS` | Employer registration |
| `DRIVER_LOGIN` | Driver login |
| `DRIVER_REGISTER` | Driver registration |
| `RANKINGS` | Fetch employer's driver rankings |
| `REPORTS` | Fleet analysis report data |
| `DEVICES` | List registered devices |
| `REGISTER_DEVICE` | Register a new Raspberry Pi device |
| `DRIVER_DASHBOARD_DETAILS` | Driver's own dashboard data |
| `DRIVER_START_TRIP` / `DRIVER_END_TRIP` | Trip lifecycle |
| `CALIB_SNAPSHOT_REQUEST` | Request calibration snapshot from device |
| `CALIB_SNAPSHOT_POLL` | Poll snapshot result by device serial |
| `CALIB_SUBMIT` | Save calibration data |

---

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later (comes with Node.js)

### Install dependencies

```bash
cd Application/Frontend
npm install
```

### Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for production

```bash
npm run build
npm start
```

### Lint

```bash
npm run lint
```

---

## Environment & Configuration

The frontend currently requires **no `.env` file** — the backend base URL is set directly in `src/lib/api-config.ts`.

If you need to switch environments (e.g. local backend, staging, production), update `API_BASE_URL` in that file.

The only external service the frontend calls directly is **Formspree** (for the support form). The Formspree form ID is set inside `src/app/api/support/route.ts`.

---

## Contributing (Frontend Team)

This directory (`Application/Frontend/`) contains **only frontend code** — Next.js pages, components, styles, and API config. Do not add backend server files here.

- Backend team: place your work under `Application/Backend/`
- Mobile/embedded team: coordinate API contract changes via `src/lib/api-config.ts`

### Branch & commit conventions

Follow the project-wide conventions agreed on by the team. For frontend changes, prefix commits with `feat(frontend):`, `fix(frontend):`, or `refactor(frontend):` as appropriate.

---

*© 2026 DARAS · Safe Journeys Secured · AI Powered*
