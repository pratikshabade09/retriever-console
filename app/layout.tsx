import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Retriever Console",
  description: "Clinic operations console",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
