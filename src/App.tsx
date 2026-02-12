import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { ChatMessage, ChatProgress, Profile } from "./types";

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
  const [avatarUnlockedByProfile, setAvatarUnlockedByProfile] = useState<
    Record<string, boolean>
  >({});
  const [progressByProfile, setProgressByProfile] = useState<
    Record<string, ChatProgress>
  >({});

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

  const refreshUnlockState = useCallback(
    async (targetUserId: string): Promise<void> => {
      if (!userId) {
        return;
      }

      const { data, error } = await supabase.rpc("can_view_avatar", {
        viewer_id: userId,
        target_id: targetUserId
      });

      if (error) {
        setAppError(error.message);
        return;
      }

      setAvatarUnlockedByProfile((prev) => ({
        ...prev,
        [targetUserId]: Boolean(data)
      }));
    },
    [userId]
  );

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

  const loadProfiles = useCallback(async (): Promise<void> => {
    if (!userId) {
      return;
    }

    setAppError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,display_name,avatar_url")
      .neq("id", userId)
      .order("display_name", { ascending: true });

    if (error) {
      setAppError(error.message);
      return;
    }

    const profileRows = (data ?? []) as Profile[];
    setProfiles(profileRows);

    await Promise.all(
      profileRows.map(async (profile) => {
        await Promise.all([
          refreshUnlockState(profile.id),
          refreshProgress(profile.id)
        ]);
      })
    );
  }, [refreshProgress, refreshUnlockState, userId]);

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
      setAvatarUnlockedByProfile({});
      setProgressByProfile({});
      return;
    }

    void loadProfiles();
  }, [loadProfiles, userId]);

  useEffect(() => {
    if (!activeRoomKey || !selectedProfileId) {
      setMessages([]);
      return;
    }

    void loadMessages();

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
          void refreshUnlockState(selectedProfileId);
          void refreshProgress(selectedProfileId);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeRoomKey, loadMessages, refreshProgress, refreshUnlockState, selectedProfileId]);

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

    await Promise.all([
      refreshUnlockState(selectedProfileId),
      refreshProgress(selectedProfileId)
    ]);
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
            const unlocked = avatarUnlockedByProfile[profile.id] ?? false;
            const progress = progressByProfile[profile.id] ?? EMPTY_PROGRESS;

            return (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  Chat mit {profile.display_name}
                </button>
                <div>Email: {profile.email}</div>
                <div>
                  Progress: du {progress.viewer_sent}/3, gegenüber{" "}
                  {progress.target_sent}/3
                </div>
                <div>Freigeschaltet: {unlocked ? "Ja" : "Nein"}</div>
                {unlocked && profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={`Profilbild ${profile.display_name}`}
                    width={120}
                    height={120}
                  />
                ) : (
                  <div>Profilbild gesperrt</div>
                )}
              </li>
            );
          })}
        </ul>
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
    </main>
  );
}
