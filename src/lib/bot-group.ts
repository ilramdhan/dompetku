/**
 * Pure, client-safe group-chat gate for the Telegram bot (issue #71). With privacy mode off the
 * bot sees every group message, so it only reacts to messages addressed to it: a reply to one of
 * its messages, a /command (without @target or @<this bot>), or an @<bot> mention — which is
 * stripped before parsing. Private chats (and old n8n bodies without chat_type) pass unchanged.
 */
export type GroupAddressInput = {
  text?: string | null | undefined;
  chatType?: string | null | undefined;
  botUsername?: string | null | undefined;
  replyToBot?: boolean | null | undefined;
};

export const isGroupChat = (chatType?: string | null) =>
  chatType === "group" || chatType === "supergroup";

const clean = (u?: string | null) => (u ?? "").trim().replace(/^@/, "") || null;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `@<bot>` not glued to a word/email; unknown username → any `@…bot` (bot usernames end in "bot"). */
const mentionRe = (bot: string | null) =>
  new RegExp(`(^|[^\\w@])@${bot ? escape(bot) : "\\w{2,}bot"}(?!\\w)`, "gi");

export function groupAddress(i: GroupAddressInput): { addressed: boolean; text: string } {
  const text = i.text ?? "";
  if (!isGroupChat(i.chatType)) return { addressed: true, text };
  const bot = clean(i.botUsername);
  const cmd = text.trim().match(/^\/\w+(?:@(\w+))?/);
  if (cmd) {
    const target = cmd[1];
    const mine =
      !target || (bot ? target.toLowerCase() === bot.toLowerCase() : /bot$/i.test(target));
    if (!mine) return { addressed: false, text };
  }
  const mentioned = mentionRe(bot).test(text);
  if (!cmd && !mentioned && !i.replyToBot) return { addressed: false, text };
  return {
    addressed: true,
    text: text.replace(mentionRe(bot), "$1").replace(/\s+/g, " ").trim(),
  };
}
