# ILMORA — demo prototype

A luxurious, responsive education-platform prototype for Tashkent. ILMORA gathers regular courses from different education centers into one monthly subscription (Duo = 2 courses, Trio = 3 courses).

**Everything here is sample data.** Centers, teachers, courses, prices, schedules, students and materials are fictional. There is no backend, no payment and no real authentication.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` produces a static bundle in `dist/`.

Stack: React 19 + TypeScript + Vite + Tailwind v4 + zustand (persisted to `localStorage`) + react-three-fiber.

## Exploring the demo

Use the **Demo role** switcher in the header (Visitor / Student / Teacher / Super Admin). No login is needed. Each role has its own workspace:

| Role | Workspace | What it controls |
| --- | --- | --- |
| Super Admin | `/admin` | Page sections & order, theme (colors, fonts, radius), brand copy, navigation, features, course templates, content status/featured, people, centers & categories, packages, permissions, announcements & FAQ |
| Teacher | `/teacher` | Subjects & courses, video lessons, playlists, guides & resources, groups & schedule, channel customization, content visibility & access |
| Student | `/student` | Overview & upcoming lessons, subscription, courses & groups, weekly timetable, accessible videos, guides & downloads, saved items, profile |

“Reset demo” (inside the role switcher) restores all defaults.

## Key behaviours

- **Three languages** — Uzbek Latin (default), Russian, English. UI strings live in `src/i18n/translations.ts`; all content is stored as `{ uz, ru, en }` objects. Switching language never resets selections.
- **Package builder** (`/builder`) — enforces the package limit, blocks duplicate courses and detects schedule conflicts between groups. The monthly total is the sum of selected course prices in so‘m.
- **Subscription preview & activation** (`/preview`) — activation is simulated; the student workspace is generated from the selections.
- **Public / Private workflow** — every course, video, playlist and resource carries `status` (draft / published / archived), `visibility` (public / private) and an `audience` (students and groups). Publishing requires an explicit visibility choice. Drafts stay internal. Private items show an access-denied state when opened directly by someone not in the audience. Rules live in `src/lib/access.ts` so a server can reuse them.
- **Admin templates propagate** — section toggles/order, theme, brand copy, nav, packages, permissions and card templates are read from one shared `site` config in the store.
- **Teacher editing boundaries** — Super Admin permissions lock price, schedule, channel and direct publishing in Teacher Studio; without direct publishing, teachers submit for review and admins approve in *Content & featured*.
- **Uploads** — local `URL.createObjectURL` previews with honest metadata. Files are never sent anywhere; previews are lost on reload (the UI says so).
- **Hero film** — the home hero is a full-viewport, muted, looping background video (`public/media/ilmora-commercial.mp4`, supplied) under a transparent header that turns ivory on scroll. It pauses offscreen, has a visible pause/play control, drifts with a subtle parallax, and falls back to a poster or brand gradient when the file is missing or reduced motion is on. The URL is editable in *Super Admin → Theme & typography → Media sources*.
- **Motion system** (novator.com.uz-inspired) — scroll reveals with staggered delays (`.reveal`, `.reveal-stagger`, left/right/scale/blur variants, driven by `RevealManager`), word-by-word headline entrance, count-up stats, a partner/category marquee ticker (pauses on hover), horizontal snap track for teachers, page transitions on route change, image zoom and arrow nudges on hover, floating decorative rings. Everything is disabled under `prefers-reduced-motion`.
- **3D** — Bazis furniture-assembly preview scene, lazy-loaded, paused offscreen, static SVG fallback without WebGL or when reduced motion is on.
- **Scroll video** — the furniture section is a sticky, scroll-scrubbed video. Scrolling down advances, up reverses, stopping holds the frame; native scrolling is preserved.

## Furniture section: scroll-driven 3D story

The Bazis section is a bounded sticky "scroll film". By default it shows a scroll-scrubbed 3D sequence (`FurnitureAssembly`): a blueprint wireframe of a chair draws in, dimension lines appear, cut boards and material swatches land on the bench, dowels line up, the boards lift into a 3D model, and the finished chair is varnished under a warm light. Scrolling down advances, scrolling up reverses, stopping holds the frame; a six-stage indicator follows the course curriculum. Without WebGL or with reduced motion it falls back to a 2D line illustration.

If a licensed clip is set as the furniture video URL in *Super Admin → Theme → Media sources* (or dropped in as `public/media/furniture-scroll.mp4` and configured), the section scrubs that video instead.

Course, teacher and video imagery is generated (deterministic abstract covers) — no stock photos are bundled. Admins and teachers can set image URLs or upload local previews.

## Deploy (public link)

The source lives in the private repository `maftunashareef/Ilmora`. The compiled site is published to GitHub Pages from the public repository `maftunashareef/ilmora-demo`:

```bash
npm run deploy
```

This type-checks, builds with `--mode pages` (base path `/ilmora-demo/`), adds the SPA `404.html` fallback, and force-pushes `dist/` to that repository. Live URL: https://maftunashareef.github.io/ilmora-demo/

Root-relative media URLs in the demo data are resolved through `src/lib/url.ts` so they work under the sub-path; the router uses the same base.

## Privacy & security notes

- Demo students are stored with a display name and district only. The center-inquiry form is never persisted.
- Demo roles and visibility checks illustrate the workflow; they are not protection for confidential files. Production needs server-side authorization.

## Structure

```
src/
  types/            domain types
  data/seed.ts      sample content + default site configuration
  store/            zustand store (persisted), selectors, viewer/access helpers
  lib/              access rules, schedule maths, formatting, theme applier
  i18n/             UZ / RU / EN dictionary + hooks
  components/       UI kit, layouts, course cards, visibility control, uploads, 3D, scroll video
  pages/public      home & template pages, courses, teachers/channels, content, builder, preview, FAQ
  pages/admin       Super Admin workspace
  pages/teacher     Teacher Studio
  pages/student     Student workspace
```
