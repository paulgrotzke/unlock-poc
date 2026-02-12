export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type ChatMessage = {
  id: number;
  room_key: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
};

export type ChatProgress = {
  viewer_sent: number;
  target_sent: number;
  unlocked: boolean;
};

export type MediaItem = {
  id: number;
  owner_id: string;
  seed_key: string;
  kind: "image" | "text";
  url: string | null;
  text_content: string | null;
  label: string | null;
  unlock_min_messages: number;
  created_at: string;
};
