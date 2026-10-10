import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { profileQuery } from "@/lib/queries";
import { initials } from "@/lib/profile";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Round avatar: the uploaded photo, else initials of the display name / username. */
export function UserAvatar({
  src,
  name,
  username,
  className,
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  username: string;
  className?: string | undefined;
}) {
  return src ? (
    <img
      src={src}
      alt=""
      className={cn("size-8 shrink-0 rounded-full border object-cover", className)}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground",
        className,
      )}
    >
      {initials(name, username)}
    </span>
  );
}

/** Header/sidebar link to /profile showing the logged-in user's avatar (and name when `labelled`). */
export function ProfileLink({
  className,
  avatarClassName,
  labelled = false,
}: {
  className?: string;
  avatarClassName?: string;
  labelled?: boolean;
}) {
  const { t } = useI18n();
  const q = useQuery({ ...profileQuery(), retry: false });
  const p = q.data?.profile;
  const label = p?.display_name || p?.username || t("Profil");
  return (
    <Link
      to="/profile"
      aria-label={label}
      title={label}
      className={cn("flex min-w-0 items-center gap-3", className)}
      activeProps={{ className: "font-semibold text-sidebar-primary" }}
    >
      <UserAvatar
        src={p?.avatar}
        name={p?.display_name}
        username={p?.username ?? ""}
        className={avatarClassName}
      />
      {labelled ? <span className="hidden min-w-0 truncate lg:inline">{label}</span> : null}
    </Link>
  );
}
