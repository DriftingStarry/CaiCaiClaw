import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "CaiCaiClaw",
    description: "M1 Web observer for CaiCaiClaw agent runtime",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="zh-CN">
            <body>
                <AntdRegistry>{children}</AntdRegistry>
            </body>
        </html>
    );
}
