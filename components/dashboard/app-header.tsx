"use client"

import { LogOutIcon, MoonIcon, SunIcon, UploadIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { faNum, formatSize } from "@/lib/client/format"

interface AppHeaderProps {
  used: number
  quota: number
  onLogout: () => void
}

export function AppHeader({ used, quota, onLogout }: AppHeaderProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
        <div className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <UploadIcon className="size-4" aria-hidden="true" />
          </span>
          آپلودساز
        </div>

        <div className="ms-auto hidden w-56 flex-col gap-1 sm:flex">
          <Progress value={percent} aria-label="فضای مصرف‌شده" />
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatSize(used)} از {formatSize(quota)} ({faNum(percent, 1)}٪)
          </span>
        </div>

        <div className="ms-auto flex items-center gap-1 sm:ms-0">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="تغییر تم"
                  onClick={() =>
                    setTheme(resolvedTheme === "dark" ? "light" : "dark")
                  }
                />
              }
            >
              <SunIcon className="hidden dark:block" aria-hidden="true" />
              <MoonIcon className="dark:hidden" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>تغییر تم</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="خروج"
                  onClick={onLogout}
                />
              }
            >
              <LogOutIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>خروج</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl px-4 pb-2 sm:hidden">
        <Progress value={percent} aria-label="فضای مصرف‌شده" />
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatSize(used)} از {formatSize(quota)}
        </span>
      </div>
    </header>
  )
}
