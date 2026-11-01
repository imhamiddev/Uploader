"use client"

import * as React from "react"

import {
  DateTimePicker,
  type DateTimePickerValue,
} from "@/components/ui/date-picker"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ExpiryPreset = "never" | "1h" | "1d" | "7d" | "30d" | "custom"

const HOUR = 3600 * 1000
const PRESET_MS: Record<Exclude<ExpiryPreset, "never" | "custom">, number> = {
  "1h": HOUR,
  "1d": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
}

const PRESETS: { value: ExpiryPreset; label: string }[] = [
  { value: "never", label: "بدون انقضا" },
  { value: "1h", label: "۱ ساعت" },
  { value: "1d", label: "۱ روز" },
  { value: "7d", label: "۷ روز" },
  { value: "30d", label: "۳۰ روز" },
  { value: "custom", label: "سفارشی" },
]

export interface ExpiryState {
  preset: ExpiryPreset
  custom: DateTimePickerValue
}

export const INITIAL_EXPIRY: ExpiryState = {
  preset: "never",
  custom: { date: null, time: { hour: 12, minute: 0 } },
}

/** Resolves the picker state to an absolute timestamp (null = never expires). */
export function resolveExpiry(state: ExpiryState): number | null | "invalid" {
  if (state.preset === "never") return null
  if (state.preset === "custom") {
    const { date, time } = state.custom
    if (!date) return "invalid"
    const d = new Date(date)
    d.setHours(time.hour, time.minute, 0, 0)
    return d.getTime() > Date.now() ? d.getTime() : "invalid"
  }
  return Date.now() + PRESET_MS[state.preset]
}

interface ExpiryPickerProps {
  value: ExpiryState
  onChange: (value: ExpiryState) => void
  disabled?: boolean
}

export function ExpiryPicker({ value, onChange, disabled }: ExpiryPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        value={[value.preset]}
        onValueChange={(v) => {
          const next = v[0] as ExpiryPreset | undefined
          if (next) onChange({ ...value, preset: next })
        }}
        variant="outline"
        size="sm"
        disabled={disabled}
        className="flex-wrap"
        aria-label="زمان انقضای لینک"
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.value} value={p.value}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {value.preset === "custom" && (
        <DateTimePicker
          value={value.custom}
          onValueChange={(custom) => onChange({ ...value, custom })}
          placeholder="انتخاب تاریخ و ساعت انقضا"
          drawerTitle="زمان انقضا"
          disabled={disabled}
          calendarProps={{ disabled: { before: new Date() } }}
          className="w-full sm:w-72"
        />
      )}
    </div>
  )
}
