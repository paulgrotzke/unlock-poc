import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { ChatMessage, ChatProgress, MediaItem, Profile } from "./types";

const DEMO_USERS = [
  { email: "user1@demo.local", password: "Demo1234!", label: "User 1" },
  { email: "user2@demo.local", password: "Demo1234!", label: "User 2" },
  { email: "user3@demo.local", password: "Demo1234!", label: "User 3" }
];

const buildRoomKey = (leftUserId: string, rightUserId: string): string => {
  return [leftUserId, rightUserId].sort().join("__");
};

const EMPTY_PROGRESS: ChatProgress = {
  viewer_sent: 0,
  target_sent: 0,
  unlocked: false
};

const MEDIA_SELECT_COLUMNS =
  "id,owner_id,seed_key,kind,url,text_content,label,unlock_min_messages,created_at" as const;

type ChatTargetRow = Profile & {
  viewer_sent: number;
  target_sent: number;
  unlocked: boolean;
};

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(DEMO_USERS[0].email);
  const [password, setPassword] = useState(DEMO_USERS[0].password);
  const [authError, setAuthError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [appError, setAppError] = useState<string | null>(null);
  const [progressByProfile, setProgressByProfile] = useState<
    Record<string, ChatProgress>
  >({});
  const [myMediaItems, setMyMediaItems] = useState<MediaItem[]>([]);
  const [selectedMyMediaId, setSelectedMyMediaId] = useState<number | null>(
    null
  );
  const [selectedMyMediaUnlockDraft, setSelectedMyMediaUnlockDraft] =
    useState<string>("");
  const [selectedMyMediaTextDraft, setSelectedMyMediaTextDraft] =
    useState<string>("");
  const [targetMediaItems, setTargetMediaItems] = useState<MediaItem[]>([]);

  const userId = session?.user.id ?? null;
  const selectedProfile = useMemo(() => {
    return profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  }, [profiles, selectedProfileId]);
  const activeRoomKey = useMemo(() => {
    if (!userId || !selectedProfileId) {
      return null;
    }

    return buildRoomKey(userId, selectedProfileId);
  }, [selectedProfileId, userId]);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session: initialSession }
      } = await supabase.auth.getSession();
      setSession(initialSession);
    };

    void init();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, updatedSession) => {
      setSession(updatedSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const refreshProgress = useCallback(
    async (targetUserId: string): Promise<void> => {
      if (!userId) {
        return;
      }

      const { data, error } = await supabase.rpc("get_chat_progress", {
        viewer_id: userId,
        target_id: targetUserId
      });

      if (error) {
        setAppError(error.message);
        return;
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        setProgressByProfile((prev) => ({
          ...prev,
          [targetUserId]: EMPTY_PROGRESS
        }));
        return;
      }

      setProgressByProfile((prev) => ({
        ...prev,
        [targetUserId]: {
          viewer_sent: Number(row.viewer_sent),
          target_sent: Number(row.target_sent),
          unlocked: Boolean(row.unlocked)
        }
      }));
    },
    [userId]
  );

  const loadMyMedia = useCallback(async (): Promise<void> => {
    if (!userId) {
      setMyMediaItems([]);
      setSelectedMyMediaId(null);
      setSelectedMyMediaUnlockDraft("");
      setSelectedMyMediaTextDraft("");
      return;
    }

    const { data, error } = await supabase
      .from("media_items")
      .select(MEDIA_SELECT_COLUMNS)
      .eq("owner_id", userId)
      .order("id", { ascending: true });

    if (error) {
      setAppError(error.message);
      return;
    }

    setMyMediaItems((data ?? []) as MediaItem[]);
  }, [userId]);

  const selectedMyMediaItem = useMemo(() => {
    if (selectedMyMediaId === null) {
      return null;
    }
    return myMediaItems.find((item) => item.id === selectedMyMediaId) ?? null;
  }, [myMediaItems, selectedMyMediaId]);

  useEffect(() => {
    if (!selectedMyMediaItem) {
      setSelectedMyMediaUnlockDraft("");
      setSelectedMyMediaTextDraft("");
      return;
    }

    setSelectedMyMediaUnlockDraft(String(selectedMyMediaItem.unlock_min_messages));
    setSelectedMyMediaTextDraft(selectedMyMediaItem.text_content ?? "");
  }, [selectedMyMediaItem]);

  const loadTargetMedia = useCallback(async (): Promise<void> => {
    if (!selectedProfileId) {
      setTargetMediaItems([]);
      return;
    }

    const { data, error } = await supabase
      .from("media_items")
      .select(MEDIA_SELECT_COLUMNS)
      .eq("owner_id", selectedProfileId)
      .order("id", { ascending: true });

    if (error) {
      setAppError(error.message);
      return;
    }

    setTargetMediaItems((data ?? []) as MediaItem[]);
  }, [selectedProfileId]);

  const loadProfiles = useCallback(async (): Promise<void> => {
    if (!userId) {
      return;
    }

    setAppError(null);
    const { data, error } = await supabase.rpc("list_chat_targets_with_progress");

    if (error) {
      setAppError(error.message);
      return;
    }

    const rows = (data ?? []) as ChatTargetRow[];
    const profileRows: Profile[] = rows.map((row) => ({
      id: row.id,
      display_name: row.display_name,
      avatar_url: row.avatar_url
    }));

    setProfiles(profileRows);
    setProgressByProfile(
      rows.reduce<Record<string, ChatProgress>>((accumulator, row) => {
        accumulator[row.id] = {
          viewer_sent: Number(row.viewer_sent),
          target_sent: Number(row.target_sent),
          unlocked: Boolean(row.unlocked)
        };
        return accumulator;
      }, {})
    );
  }, [userId]);

  const loadMessages = useCallback(async (): Promise<void> => {
    if (!activeRoomKey) {
      setMessages([]);
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .select("id,room_key,sender_id,receiver_id,body,created_at")
      .eq("room_key", activeRoomKey)
      .order("created_at", { ascending: true });

    if (error) {
      setAppError(error.message);
      return;
    }

    setMessages((data ?? []) as ChatMessage[]);
  }, [activeRoomKey]);

  useEffect(() => {
    if (!userId) {
      setProfiles([]);
      setSelectedProfileId(null);
      setMessages([]);
      setProgressByProfile({});
      setMyMediaItems([]);
      setSelectedMyMediaId(null);
      setSelectedMyMediaUnlockDraft("");
      setSelectedMyMediaTextDraft("");
      setTargetMediaItems([]);
      return;
    }

    const ensureAndLoad = async (): Promise<void> => {
      setAppError(null);

      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        setAppError(error.message);
        return;
      }

      if (!data) {
        setAuthError(
          "Session ist nicht mehr gueltig (z.B. nach supabase db reset). Bitte erneut einloggen."
        );
        await supabase.auth.signOut();
        return;
      }

      await Promise.all([loadProfiles(), loadMyMedia()]);
    };

    void ensureAndLoad();
  }, [loadMyMedia, loadProfiles, userId]);

  useEffect(() => {
    void loadTargetMedia();
  }, [loadTargetMedia]);

  useEffect(() => {
    if (!activeRoomKey || !selectedProfileId) {
      setMessages([]);
      return;
    }

    void loadMessages();
    void loadTargetMedia();

    const channel = supabase
      .channel(`room-${activeRoomKey}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_key=eq.${activeRoomKey}`
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((previous) => {
            if (previous.some((message) => message.id === row.id)) {
              return previous;
            }

            return [...previous, row];
          });
          void refreshProgress(selectedProfileId);
          void loadTargetMedia();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeRoomKey, loadMessages, loadTargetMedia, refreshProgress, selectedProfileId]);

  const handleEmailPasswordLogin = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    setAuthError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setAuthError(error.message);
    }
  };

  const handleDemoLogin = async (
    demoEmail: string,
    demoPassword: string
  ): Promise<void> => {
    setAuthError(null);
    setEmail(demoEmail);
    setPassword(demoPassword);

    const { error } = await supabase.auth.signInWithPassword({
      email: demoEmail,
      password: demoPassword
    });

    if (error) {
      setAuthError(error.message);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    setSelectedProfileId(null);
    setMessages([]);
    await supabase.auth.signOut();
  };

  const handleSendMessage = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();

    if (!userId || !selectedProfileId || !activeRoomKey) {
      return;
    }

    const cleanBody = messageDraft.trim();
    if (!cleanBody) {
      return;
    }

    setAppError(null);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_key: activeRoomKey,
        sender_id: userId,
        receiver_id: selectedProfileId,
        body: cleanBody
      })
      .select("id,room_key,sender_id,receiver_id,body,created_at")
      .single();

    if (error) {
      setAppError(error.message);
      return;
    }

    setMessageDraft("");
    if (data) {
      const inserted = data as ChatMessage;
      setMessages((previous) => {
        if (previous.some((message) => message.id === inserted.id)) {
          return previous;
        }

        return [...previous, inserted];
      });
    }

    await Promise.all([refreshProgress(selectedProfileId), loadTargetMedia()]);
  };

  const handleUpdateSelectedMyMedia = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();

    if (!selectedMyMediaItem) {
      return;
    }

    const value = Number.parseInt(selectedMyMediaUnlockDraft.trim(), 10);
    if (!Number.isFinite(value) || value < 0) {
      setAppError("Ungültiger Wert (>= 0).");
      return;
    }

    const update: Record<string, unknown> = { unlock_min_messages: value };
    if (selectedMyMediaItem.kind === "text") {
      const cleanText = selectedMyMediaTextDraft.trim();
      if (!cleanText) {
        setAppError("Text darf nicht leer sein.");
        return;
      }
      update.text_content = cleanText;
    }

    const { error } = await supabase
      .from("media_items")
      .update(update)
      .eq("id", selectedMyMediaItem.id);

    if (error) {
      setAppError(error.message);
      return;
    }

    await loadMyMedia();
  };

  if (!session) {
    return (
      <main>
        <section>
          <h1>Login</h1>
          <form onSubmit={handleEmailPasswordLogin}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <input
              type="password"
              placeholder="Passwort"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button type="submit">Einloggen</button>
          </form>
          <p>Demo-Logins:</p>
          <ul>
            {DEMO_USERS.map((user) => (
              <li key={user.email}>
                <button
                  type="button"
                  onClick={() => handleDemoLogin(user.email, user.password)}
                >
                  {user.label}
                </button>
                {" "}
                ({user.email} / {user.password})
              </li>
            ))}
          </ul>
          {authError && <p>Auth Fehler: {authError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main>
      <section>
        <h1>Realtime Chat POC</h1>
        <p>Eingeloggt als: {session.user.email}</p>
        <button type="button" onClick={handleSignOut}>
          Logout
        </button>
        {appError && <p>Fehler: {appError}</p>}
      </section>

      <section>
        <h2>Profile</h2>
        <ul>
          {profiles.map((profile) => {
            const progress = progressByProfile[profile.id] ?? EMPTY_PROGRESS;

            return (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  Chat mit {profile.display_name}
                </button>
                <div>
                  Progress: du {progress.viewer_sent}, gegenüber {progress.target_sent}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

	      <section>
	        <h2>My Media</h2>
	        <p>
	          Klicke ein Item und setze, ab wie vielen Nachrichten pro Richtung es
	          sichtbar sein soll (beide muessen mindestens X senden).
	        </p>
	        {myMediaItems.length === 0 ? (
	          <p>
	            Keine Items gefunden. Tipp: Seeds sind fuer User1 und User2 vorhanden.
	            Wenn du gerade die DB resettet hast: einmal Logout und neu einloggen.
	          </p>
	        ) : null}
	        <ul>
	          {myMediaItems.map((item) => (
	            <li key={item.id}>
	              <button
	                type="button"
	                onClick={() => setSelectedMyMediaId(item.id)}
	              >
	                Auswaehlen {item.label ?? `#${item.id}`} ({item.kind})
	              </button>
	              <div>Unlock ab: {item.unlock_min_messages}</div>
	              {item.kind === "image" ? (
	                item.url ? (
	                  <img
	                    src={item.url}
	                    alt={item.label ?? `Media ${item.id}`}
	                    width={120}
	                    height={120}
	                  />
	                ) : (
	                  <div>Fehler: Bild-URL fehlt</div>
	                )
	              ) : (
	                <pre>{item.text_content ?? ""}</pre>
	              )}
	            </li>
	          ))}
	        </ul>

	        {selectedMyMediaItem ? (
	          <form onSubmit={handleUpdateSelectedMyMedia}>
	            <div>
	              Ausgewaehlt: {selectedMyMediaItem.label ?? `#${selectedMyMediaItem.id}`}
	            </div>
	            <div>Typ: {selectedMyMediaItem.kind}</div>
	            {selectedMyMediaItem.kind === "text" ? (
	              <textarea
	                value={selectedMyMediaTextDraft}
	                onChange={(event) => setSelectedMyMediaTextDraft(event.target.value)}
	                placeholder="Text (freies Feld)"
	                rows={4}
	                cols={40}
	              />
	            ) : null}
	            <input
	              type="number"
	              min={0}
	              value={selectedMyMediaUnlockDraft}
	              onChange={(event) => setSelectedMyMediaUnlockDraft(event.target.value)}
	              placeholder="Unlock-Min (z.B. 3)"
	            />
	            <button type="submit">Speichern</button>
	          </form>
	        ) : (
	          <p>Kein Item ausgewaehlt.</p>
	        )}
	      </section>

      <section>
        <h2>Chat</h2>
        {!selectedProfile ? (
          <p>Bitte ein Profil auswählen.</p>
        ) : (
          <>
            <p>Aktiver Chat mit {selectedProfile.display_name}</p>
            <ul>
              {messages.map((message) => (
                <li key={message.id}>
                  [{new Date(message.created_at).toLocaleTimeString()}]{" "}
                  {message.sender_id === userId ? "Du" : selectedProfile.display_name}
                  : {message.body}
                </li>
              ))}
            </ul>
            <form onSubmit={handleSendMessage}>
              <input
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                placeholder="Nachricht"
              />
              <button type="submit">Senden</button>
            </form>
          </>
        )}
      </section>

	      <section>
	        <h2>Media vom Profil</h2>
	        {!selectedProfile ? (
	          <p>Bitte ein Profil auswählen.</p>
	        ) : targetMediaItems.length === 0 ? (
	          <p>Keine freigeschalteten Items (noch).</p>
	        ) : (
	          <ul>
	            {targetMediaItems.map((item) => (
	              <li key={item.id}>
	                <div>
	                  {item.label ?? `#${item.id}`} (Unlock ab: {item.unlock_min_messages})
	                </div>
	                {item.kind === "image" ? (
	                  item.url ? (
	                    <img
	                      src={item.url}
	                      alt={item.label ?? `Media ${item.id}`}
	                      width={120}
	                      height={120}
	                    />
	                  ) : (
	                    <div>Fehler: Bild-URL fehlt</div>
	                  )
	                ) : (
	                  <pre>{item.text_content ?? ""}</pre>
	                )}
	              </li>
	            ))}
	          </ul>
	        )}
	      </section>
    </main>
  );
}
