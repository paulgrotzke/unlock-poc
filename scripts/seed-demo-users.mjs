import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY;

const isJwtLike = (value) => {
  return typeof value === "string" && value.split(".").length === 3;
};

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars.");
  console.error(
    "Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)."
  );
  console.error("Tip: get local keys via `supabase status -o env`.");
  process.exit(1);
}

if (!isJwtLike(SUPABASE_SERVICE_ROLE_KEY)) {
  console.error("Invalid service role key (expected a JWT with 3 segments).");
  console.error(
    "Use SERVICE_ROLE_KEY from `supabase status -o env`, not sb_secret_... or S3 keys."
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const DEMO_USERS = [
  {
    email: "user1@demo.local",
    password: "Demo1234!",
    displayName: "User 1",
    avatarUrl: "https://i.pravatar.cc/200?img=1",
    media: [
      ...Array.from({ length: 5 }).map((_, index) => {
        const number = index + 1;
        return {
          seedKey: `u1-img-${number}`,
          kind: "image",
          label: `U1-IMG-${number}`,
          url: `https://picsum.photos/seed/unlockpoc-u1-${number}/300/300`,
          unlockMinMessages: 3
        };
      }),
      {
        seedKey: "u1-txt-1",
        kind: "text",
        label: "U1-TXT-1",
        textContent: "User 1 Text Snippet #1 (freies Feld)",
        unlockMinMessages: 1
      },
      {
        seedKey: "u1-txt-2",
        kind: "text",
        label: "U1-TXT-2",
        textContent: "User 1 Text Snippet #2 (freies Feld)",
        unlockMinMessages: 3
      },
      {
        seedKey: "u1-txt-3",
        kind: "text",
        label: "U1-TXT-3",
        textContent: "User 1 Text Snippet #3 (freies Feld)",
        unlockMinMessages: 5
      }
    ]
  },
  {
    email: "user2@demo.local",
    password: "Demo1234!",
    displayName: "User 2",
    avatarUrl: "https://i.pravatar.cc/200?img=2",
    media: [
      ...Array.from({ length: 5 }).map((_, index) => {
        const number = index + 1;
        return {
          seedKey: `u2-img-${number}`,
          kind: "image",
          label: `U2-IMG-${number}`,
          url: `https://picsum.photos/seed/unlockpoc-u2-${number}/300/300`,
          unlockMinMessages: 3
        };
      }),
      {
        seedKey: "u2-txt-1",
        kind: "text",
        label: "U2-TXT-1",
        textContent: "User 2 Text Snippet #1 (freies Feld)",
        unlockMinMessages: 1
      },
      {
        seedKey: "u2-txt-2",
        kind: "text",
        label: "U2-TXT-2",
        textContent: "User 2 Text Snippet #2 (freies Feld)",
        unlockMinMessages: 3
      },
      {
        seedKey: "u2-txt-3",
        kind: "text",
        label: "U2-TXT-3",
        textContent: "User 2 Text Snippet #3 (freies Feld)",
        unlockMinMessages: 5
      }
    ]
  },
  {
    email: "user3@demo.local",
    password: "Demo1234!",
    displayName: "User 3",
    avatarUrl: "https://i.pravatar.cc/200?img=3"
  }
];

const findUserByEmail = async (email) => {
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const users = data?.users ?? [];
    const found = users.find((entry) => entry.email === email);
    if (found) {
      return found;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }
};

const ensureDemoUser = async (demoUser) => {
  let user = await findUserByEmail(demoUser.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: demoUser.email,
      password: demoUser.password,
      email_confirm: true
    });

    if (error) {
      throw error;
    }

    user = data.user;
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: user.id,
      email: demoUser.email,
      display_name: demoUser.displayName,
      avatar_url: demoUser.avatarUrl
    },
    { onConflict: "id" }
  );

  if (profileError) {
    throw profileError;
  }

  if (Array.isArray(demoUser.media) && demoUser.media.length > 0) {
    const rows = demoUser.media.map((item) => ({
      owner_id: user.id,
      seed_key: item.seedKey,
      kind: item.kind,
      url: item.kind === "image" ? item.url : null,
      text_content: item.kind === "text" ? item.textContent : null,
      label: item.label ?? null,
      unlock_min_messages: item.unlockMinMessages ?? 3
    }));

    const { error: mediaError } = await admin
      .from("media_items")
      .upsert(rows, { onConflict: "owner_id,seed_key" });

    if (mediaError) {
      throw mediaError;
    }
  }
};

const run = async () => {
  for (const demoUser of DEMO_USERS) {
    await ensureDemoUser(demoUser);
  }

  console.log("Demo users are ready:");
  for (const demoUser of DEMO_USERS) {
    console.log(`- ${demoUser.email} / ${demoUser.password}`);
  }
};

run().catch((error) => {
  console.error("Failed to seed demo users:", error.message);
  process.exit(1);
});
