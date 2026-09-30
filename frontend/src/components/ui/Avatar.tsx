export function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) return <img src={src} alt={name} referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover" />;
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
