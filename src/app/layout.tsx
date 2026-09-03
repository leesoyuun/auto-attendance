import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "출석 체크",
  description: "런닝크루 출석 체크와 포인트 집계",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 현장에서 폰으로 쓰는 화면이라 확대를 막지 않습니다.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
