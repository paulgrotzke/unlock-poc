export type Profile = {
  id: string;
  email: string;
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
