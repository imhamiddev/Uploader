"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogDesktopOnly,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogPanel,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Switch } from "@/components/ui/switch"
import type { FileView } from "@/lib/server/types"

import {
  ExpiryPicker,
  INITIAL_EXPIRY,
  resolveExpiry,
  type ExpiryState,
} from "./expiry-picker"

export interface EditPatch {
  name: string
  expiresAt?: number | null
  password?: string
  removePassword?: boolean
}

interface EditDialogProps {
  file: FileView | null
  onOpenChange: (open: boolean) => void
  onSave: (file: FileView, patch: EditPatch) => Promise<void>
}

export function EditDialog({ file, onOpenChange, onSave }: EditDialogProps) {
  return (
    <ResponsiveDialog open={!!file} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        {file && (
          <EditForm
            key={file.id}
            file={file}
            onSave={onSave}
            onDone={() => onOpenChange(false)}
          />
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function EditForm({
  file,
  onSave,
  onDone,
}: {
  file: FileView
  onSave: EditDialogProps["onSave"]
  onDone: () => void
}) {
  const [name, setName] = React.useState(file.name)
  const [changeExpiry, setChangeExpiry] = React.useState(false)
  const [expiry, setExpiry] = React.useState<ExpiryState>(INITIAL_EXPIRY)
  const [password, setPassword] = React.useState("")
  const [removePassword, setRemovePassword] = React.useState(false)
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  async function submit() {
    const patch: EditPatch = { name }
    if (changeExpiry) {
      const resolved = resolveExpiry(expiry)
      if (resolved === "invalid") {
        setError("یک تاریخ و ساعت در آینده انتخاب کنید.")
        return
      }
      patch.expiresAt = resolved
    }
    if (removePassword) patch.removePassword = true
    else if (password) patch.password = password

    setSaving(true)
    setError("")
    try {
      await onSave(file, patch)
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <>
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>ویرایش فایل</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>
          نام دانلود، زمان انقضا و رمز لینک را تغییر دهید.
        </ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      <ResponsiveDialogPanel>
        <FieldGroup>
          <Field>
            <FieldLabel>نام فایل</FieldLabel>
            <Input
              dir="auto"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldLabel>تغییر زمان انقضا</FieldLabel>
            <Switch checked={changeExpiry} onCheckedChange={setChangeExpiry} />
          </Field>
          {changeExpiry && <ExpiryPicker value={expiry} onChange={setExpiry} />}

          {file.hasPassword && (
            <Field orientation="horizontal">
              <FieldLabel>حذف رمز لینک</FieldLabel>
              <Switch
                checked={removePassword}
                onCheckedChange={setRemovePassword}
              />
            </Field>
          )}
          {!removePassword && (
            <Field>
              <FieldLabel>
                {file.hasPassword ? "رمز جدید لینک" : "رمز لینک"}
              </FieldLabel>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={file.hasPassword ? "بدون تغییر" : "بدون رمز"}
                autoComplete="new-password"
              />
              <FieldDescription>
                خالی بگذارید تا رمز فعلی بدون تغییر بماند.
              </FieldDescription>
            </Field>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </FieldGroup>
      </ResponsiveDialogPanel>

      <ResponsiveDialogFooter>
        <ResponsiveDialogDesktopOnly>
          <ResponsiveDialogClose render={<Button variant="outline" />}>
            انصراف
          </ResponsiveDialogClose>
        </ResponsiveDialogDesktopOnly>
        <Button loading={saving} onClick={submit}>
          ذخیره
        </Button>
      </ResponsiveDialogFooter>
    </>
  )
}
