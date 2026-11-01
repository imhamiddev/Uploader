"use client"

import { CircleAlertIcon, LockKeyholeIcon } from "lucide-react"
import * as React from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { PasswordInput } from "@/components/ui/password-input"
import { api } from "@/lib/client/api"

/** Verifies the link password, then starts the file download. */
export function PasswordGate({ token }: { token: string }) {
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const { file } = await api<{ file: string }>(`/d/${token}/auth`, {
        method: "POST",
        json: { password },
      })
      window.location.href = file
      setPassword("")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field>
        <FieldLabel>رمز عبور فایل</FieldLabel>
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          required
          autoFocus
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" loading={loading} className="w-full">
        <LockKeyholeIcon data-icon="inline-start" aria-hidden="true" />
        باز کردن و دانلود
      </Button>
    </form>
  )
}
