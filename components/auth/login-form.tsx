"use client"

import { CircleAlertIcon, UploadIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { api } from "@/lib/client/api"

export function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [error, setError] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      await api("/api/login", { method: "POST", json: { username, password } })
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
      setPassword("")
      setLoading(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <UploadIcon className="size-6" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg">آپلودساز</CardTitle>
          <CardDescription>
            برای ورود به پنل مدیریت، مشخصات خود را وارد کنید.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field>
              <FieldLabel>نام کاربری</FieldLabel>
              <Input
                dir="ltr"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </Field>
            <Field>
              <FieldLabel>رمز عبور</FieldLabel>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon aria-hidden="true" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" loading={loading} className="w-full">
              ورود
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
