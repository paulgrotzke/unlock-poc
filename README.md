# Unlock POC (Frontend + Supabase)

Minimaler lokaler POC für diesen Use Case:

- Zwei User chatten in Realtime.
- Jeder User hat eine Media-Library (Bilder).
- Zusätzlich gibt es eine zweite Media-Form: freier Text (Text-Snippets).
- Pro Bild kann der Owner festlegen, ab wie vielen Nachrichten (pro Richtung) es sichtbar wird:
  - sichtbar, wenn **beide User** im gegenseitigen Chat jeweils **>= X** Nachrichten gesendet haben.
- User 1 und User 2 haben jeweils 5 seeded Bilder.
  - plus seeded Text-Snippets.

## Setup

1. Dependencies installieren:

```bash
npm ci
```

2. Umgebungsvariablen setzen:

```bash
cp .env.example .env
```

Für lokale Supabase Keys nutze `supabase status -o env` und kopiere:

- `API_URL` → `VITE_SUPABASE_URL`
- `ANON_KEY` (JWT) → `VITE_SUPABASE_ANON_KEY`
- `SERVICE_ROLE_KEY` (JWT) → `SUPABASE_SERVICE_ROLE_KEY` (nur Seeder, nie Browser)

3. SQL-Migration in Supabase ausführen:

- Datei: `supabase/migrations/20260212160000_init.sql`
- Inhalt in Supabase SQL Editor ausführen.

4. Demo-User erzeugen:

```bash
npm run seed:users
```

5. Frontend lokal starten:

```bash
npm run dev
```


## Tests & Build (Local/CI)

CI-freundliche Kommandos ("npm test" nutzt `vitest run`):

```bash
npm ci
npm test
npm run build
```

Secret-Hygiene: `.env` ist via `.gitignore` ausgeschlossen; bitte nur `.env.example` committen.

## Demo-Accounts

- `user1@demo.local` / `Demo1234!`
- `user2@demo.local` / `Demo1234!`
- `user3@demo.local` / `Demo1234!`

## Testablauf

1. Browserfenster A: Login mit `user1@demo.local`.
2. Browserfenster B (Incognito): Login mit `user2@demo.local`.
3. In "My Media" bei User 2 ein Bild auswählen und `Unlock-Min` z.B. auf `1` setzen.
4. Beide senden im gleichen Chat je 1 Nachricht.
5. In Fenster A im Abschnitt "Media vom Profil" erscheinen dann die freigeschalteten Bilder von User 2 (je nach konfiguriertem `Unlock-Min`).
