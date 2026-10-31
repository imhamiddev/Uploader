import { Dashboard } from "@/components/dashboard/dashboard"
import { LoginForm } from "@/components/auth/login-form"
import { isAdminSession } from "@/lib/server/auth"

export const dynamic = "force-dynamic"

export default async function Home() {
  return (await isAdminSession()) ? <Dashboard /> : <LoginForm />
}
