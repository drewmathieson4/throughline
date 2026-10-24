import { cn } from "@/lib/utils";
import { initialsOf, type Colour } from "@/lib/avatar";

// By diameter in px, the ones the screens use.
const sizes = {
  30: "size-[30px] text-[10.5px]",
  36: "size-9 text-xs",
  42: "size-[42px] text-[13px]",
  56: "size-14 text-[17px]",
  72: "size-[72px] text-[22px]",
};

// Decorative: the name is always written next to it, so screen readers skip the initials.
// `colour` is the class's (the notes store's colourOf), for a class and for its students alike.
export function Avatar({ colour, name, size = 42, square = false, className }: { colour: Colour; name: string; size?: keyof typeof sizes; square?: boolean; className?: string }) {
  const { bg, fg } = colour;
  return (
    <span
      aria-hidden
      style={{ background: bg, color: fg }}
      className={cn("inline-flex flex-none items-center justify-center font-extrabold", square ? "rounded-[30%]" : "rounded-full", sizes[size], className)}
    >
      {initialsOf(name)}
    </span>
  );
}
