"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Linear-style motion on the stock colors. The thumb travels on a spring
 * curve that overshoots its target and settles back; hovering nudges it a
 * half-step toward the next position (on the rounded before/after halves,
 * tinted via bg-[inherit] so they never alter the palette), and pressing
 * stretches it along the travel direction with a matching vertical squash.
 * Every transform ships an rtl: twin, and the squish origin flips with both
 * state and direction, so the motion mirrors correctly in RTL.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // p-px + h-5/sm:h-4 keeps the thumb on even 1px gaps vertically
        // (h-[1.15rem] centered a 16px thumb on fractional pixels), and the
        // bit-packed --travel lands the checked position with a matching 2px
        // edge gap (padding + border) on both sides.
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent p-px shadow-xs transition-[background-color,border-color,box-shadow,opacity] duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=default]:[--travel:12px] data-[size=sm]:h-4 data-[size=sm]:w-6 data-[size=sm]:[--travel:8px] data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          // Tailwind v4 compiles translate-x-*/scale-x-* to the standalone
          // `translate`/`scale` properties, so those are what must transition —
          // `transform` matches nothing and the motion snaps instantly.
          // Halves use logical start/end (not left/right or ltr:/rtl:) because
          // the docs site nests dir="rtl" previews under an ltr <html>, where
          // ltr: and rtl: variants BOTH match. Logical properties resolve
          // against the nearest dir ancestor with no variant ambiguity.
          "pointer-events-none relative block rounded-full bg-background ring-0 [transition:translate_300ms_cubic-bezier(0.34,1.56,0.64,1),scale_300ms_cubic-bezier(0.34,1.56,0.64,1)] before:absolute before:inset-y-0 before:start-0 before:w-[calc(50%+2px)] before:rounded-s-full before:bg-[inherit] before:content-[''] before:[transition:translate_200ms_cubic-bezier(0.34,1.56,0.64,1),margin_200ms_cubic-bezier(0.34,1.56,0.64,1)] after:absolute after:inset-y-0 after:end-0 after:w-[calc(50%+2px)] after:rounded-e-full after:bg-[inherit] after:content-[''] after:[transition:translate_200ms_cubic-bezier(0.34,1.56,0.64,1),margin_200ms_cubic-bezier(0.34,1.56,0.64,1)]",
          "group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 group-data-checked/switch:translate-x-(--travel) rtl:group-data-checked/switch:-translate-x-(--travel) dark:group-data-checked/switch:bg-primary-foreground dark:group-data-unchecked/switch:bg-foreground",
          // Hover nudge: a half-step toward the next (inline-end/start) position.
          // Negative margin on the anchored edge pokes the half outward, in the
          // reading direction, in both LTR and RTL — no direction variants needed.
          "group-data-checked/switch:group-[:not([data-disabled])]/switch:group-hover/switch:before:-ms-0.5 group-data-unchecked/switch:group-[:not([data-disabled])]/switch:group-hover/switch:after:-me-0.5",
          // Press: stretch along the travel direction, squash vertically.
          "group-data-unchecked/switch:group-active/switch:origin-left group-data-unchecked/switch:group-active/switch:scale-x-110 group-data-unchecked/switch:group-active/switch:scale-y-90 rtl:group-data-unchecked/switch:group-active/switch:origin-right",
          "group-data-checked/switch:group-active/switch:origin-right group-data-checked/switch:group-active/switch:scale-x-110 group-data-checked/switch:group-active/switch:scale-y-90 rtl:group-data-checked/switch:group-active/switch:origin-left",
          "group-data-disabled/switch:group-active/switch:scale-x-100 group-data-disabled/switch:group-active/switch:scale-y-100"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
