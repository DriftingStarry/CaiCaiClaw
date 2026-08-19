/**
 * QQ 开放平台 access_token 管理与自动续期
 *
 * access_token 有效期 7200s，且不随请求刷新。在过期前 60s 内获取新 token 时，
 * 老 token 仍在这 60s 内有效。建议定时刷新以防过期。
 */

export interface TokenConfig {
    appId: string;
    clientSecret: string;
    apiBaseUrl: string;
}

export interface AccessTokenResponse {
    access_token: string;
    expires_in: number;
}

export interface TokenError {
    err_code: number;
    message: string;
    trace_id?: string;
}

export class TokenManager {
    private token: string | null = null;
    private expiresAt: number = 0;
    private renewalTimer: NodeJS.Timeout | null = null;
    private readonly config: TokenConfig;

    // 在过期前多久开始续期（毫秒）
    private readonly RENEWAL_BUFFER_MS = 300_000; // 5 分钟

    constructor(config: TokenConfig) {
        this.config = config;
    }

    /**
     * 获取当前有效的 access_token，若不存在或即将过期则先刷新
     */
    async getToken(): Promise<string> {
        const now = Date.now();
        if (!this.token || now >= this.expiresAt - this.RENEWAL_BUFFER_MS) {
            await this.refreshToken();
        }
        return this.token!;
    }

    /**
     * 主动刷新 access_token
     */
    private async refreshToken(): Promise<void> {
        const url = `${this.config.apiBaseUrl}/app/getAppAccessToken`;
        const body = JSON.stringify({
            appId: this.config.appId,
            clientSecret: this.config.clientSecret,
        });

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch access_token: HTTP ${response.status}`);
        }

        const data = (await response.json()) as AccessTokenResponse | TokenError;

        if ("err_code" in data && data.err_code !== 0) {
            // 凭据不进入错误信息
            throw new Error(`QQ API error ${data.err_code}: ${data.message}`);
        }

        const tokenData = data as AccessTokenResponse;
        this.token = tokenData.access_token;
        this.expiresAt = Date.now() + tokenData.expires_in * 1000;

        // 日志只能写 stderr：adapter 的 stdout 被 MCP StdioServerTransport 占用。
        console.error(`[TokenManager] access_token refreshed, expires in ${tokenData.expires_in}s`);

        // 调度下次续期
        this.scheduleRenewal();
    }

    /**
     * 调度下次自动续期
     */
    private scheduleRenewal(): void {
        if (this.renewalTimer) {
            clearTimeout(this.renewalTimer);
        }

        const renewAt = this.expiresAt - this.RENEWAL_BUFFER_MS;
        const delay = Math.max(0, renewAt - Date.now());

        this.renewalTimer = setTimeout(() => {
            this.refreshToken().catch((err) => {
                console.error("[TokenManager] Auto-renewal failed:", err);
                // 重试：1 分钟后再试
                setTimeout(() => {
                    this.refreshToken().catch((e) => console.error("[TokenManager] Retry failed:", e));
                }, 60_000);
            });
        }, delay);
    }

    /**
     * 启动 token 管理：立即获取第一个 token
     */
    async start(): Promise<void> {
        await this.refreshToken();
    }

    /**
     * 停止自动续期
     */
    stop(): void {
        if (this.renewalTimer) {
            clearTimeout(this.renewalTimer);
            this.renewalTimer = null;
        }
    }
}
