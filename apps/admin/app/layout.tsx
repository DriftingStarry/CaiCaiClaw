import { AntdRegistry } from "@ant-design/nextjs-registry";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
    title: "CaiCaiClaw Admin",
    description: "Local CaiCaiClaw agent administration console",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="zh-CN">
            <body>
                <AntdRegistry>
                    <nav className="border-b border-white/70 bg-white/60 px-4 py-3 shadow-sm backdrop-blur md:px-8">
                        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
                            <Link className="font-semibold text-emerald-950" href="/chat">
                                CaiCaiClaw Admin
                            </Link>
                            <div className="flex gap-2 text-sm">
                                <Link className="rounded-lg px-3 py-1 hover:bg-emerald-100" href="/chat">
                                    Chat
                                </Link>
                                <Link className="rounded-lg px-3 py-1 hover:bg-emerald-100" href="/agent">
                                    Agent
                                </Link>
                                <Link className="rounded-lg px-3 py-1 hover:bg-emerald-100" href="/memory">
                                    Memory
                                </Link>
                                <Link className="rounded-lg px-3 py-1 hover:bg-emerald-100" href="/logs">
                                    Logs
                                </Link>
                            </div>
                        </div>
                    </nav>
                    {children}
                </AntdRegistry>
            </body>
        </html>
    );
}
