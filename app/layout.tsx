import type { Metadata, Viewport } from "next"
import { DirectionProvider } from "@base-ui/react/direction-provider"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { ToastProvider } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fontVariables } from "@/lib/fonts"

export const metadata: Metadata = {
  title: {
    default: "آپلودساز",
    template: "%s | آپلودساز",
  },
  description:
    "آپلودساز شخصی با لینک اشتراک‌گذاری منقضی‌شونده و رمزدار",
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="fa-IR"
      dir="rtl"
      suppressHydrationWarning
      className={`${fontVariables} font-sans antialiased`}
    >
      <body>
        <DirectionProvider direction="rtl">
          <ThemeProvider>
            <TooltipProvider>
              <ToastProvider position="bottom-center">{children}</ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </DirectionProvider>
      </body>
    </html>
  )
}
