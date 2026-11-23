import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "将进酒俱乐部专属报名",
  description: "查看将进酒足球俱乐部的球局并报名。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
