# Unlock POC (Frontend + Supabase)

Minimaler lokaler POC für diesen Use Case:

- Zwei User chatten in Realtime.
- Erst wenn **beide User jeweils mindestens 3 Nachrichten** im gemeinsamen Chat gesendet haben, wird das Profilbild freigeschaltet.
- User 1 kann mit User 2 schreiben und danach User-2-Profilbild sehen.
- User 3 bleibt gesperrt, solange die 3/3-Bedingung mit User 1 nicht erfüllt ist.

## Setup

1. Dependencies installieren:

```bash
npm install
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

## Demo-Accounts

- `user1@demo.local` / `Demo1234!`
- `user2@demo.local` / `Demo1234!`
- `user3@demo.local` / `Demo1234!`

## Testablauf

1. Browserfenster A: Login mit `user1@demo.local`.
2. Browserfenster B (Incognito): Login mit `user2@demo.local`.
3. Beide senden im gleichen Chat je 3 Nachrichten.
4. In Fenster A ist das Profilbild von User 2 dann freigeschaltet.
5. In Fenster A beim Profil von User 3 bleibt das Bild gesperrt (kein 3/3-Status).
