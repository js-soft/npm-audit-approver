import { createAppJwt } from "./crypto.js"
import type { PullRequestCommit, PullRequestReview } from "./types.js"

export class GitHubClient {
    public constructor(
        private readonly appId: string,
        private readonly privateKey: string
    ) {}

    public async createInstallationAccessToken(installationId: number): Promise<string> {
        const response = await this.request<{ token: string }>({
            body: {},
            method: "POST",
            path: `/app/installations/${installationId}/access_tokens`,
            token: createAppJwt(this.appId, this.privateKey)
        })

        return response.token
    }

    public async listPullRequestCommits(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestCommit[]> {
        const commits: PullRequestCommit[] = []
        let path: string | undefined =
            `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/commits?per_page=100`

        while (path) {
            const response = await this.requestWithHeaders<PullRequestCommit[]>({
                method: "GET",
                path,
                token: input.token
            })

            commits.push(...response.data)
            path = getNextPagePath(response.headers.get("link"))
        }

        return commits
    }

    public async approvePullRequest(input: {
        readonly body: string
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<void> {
        await this.request({
            body: {
                body: input.body,
                event: "APPROVE"
            },
            method: "POST",
            path: `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/reviews`,
            token: input.token
        })
    }

    public async listPullRequestReviews(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestReview[]> {
        const reviews: PullRequestReview[] = []
        let path: string | undefined =
            `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/reviews?per_page=100`

        while (path) {
            const response = await this.requestWithHeaders<PullRequestReview[]>({
                method: "GET",
                path,
                token: input.token
            })

            reviews.push(...response.data)
            path = getNextPagePath(response.headers.get("link"))
        }

        return reviews
    }

    private async request<T = unknown>(input: RequestInput): Promise<T> {
        const response = await this.requestWithHeaders<T>(input)

        return response.data
    }

    private async requestWithHeaders<T = unknown>(input: RequestInput): Promise<{ data: T; headers: Headers }> {
        const url = input.path.startsWith("http") ? input.path : `https://api.github.com${input.path}`
        const response = await fetch(url, {
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
            headers: {
                accept: "application/vnd.github+json",
                authorization: `Bearer ${input.token}`,
                "content-type": "application/json",
                "user-agent": "js-soft-npm-audit-approver",
                "x-github-api-version": "2022-11-28"
            },
            method: input.method
        })

        if (!response.ok) {
            const responseBody = await response.text()

            throw new Error(`GitHub API ${input.method} ${url} failed with ${response.status}: ${responseBody}`)
        }

        if (response.status === 204) {
            return { data: undefined as T, headers: response.headers }
        }

        return {
            data: (await response.json()) as T,
            headers: response.headers
        }
    }
}

interface RequestInput {
    readonly body?: unknown
    readonly method: "GET" | "POST"
    readonly path: string
    readonly token: string
}

function getNextPagePath(linkHeader: string | null): string | undefined {
    if (!linkHeader) return undefined

    const nextLink = linkHeader
        .split(",")
        .map((link) => link.trim())
        .find((link) => link.endsWith('rel="next"'))

    if (!nextLink) return undefined

    const match = nextLink.match(/^<([^>]+)>/)

    if (!match) return undefined

    return match[1]
}
