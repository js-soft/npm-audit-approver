import { createHmac } from "node:crypto"
import type { AddressInfo } from "node:net"
import assert from "node:assert/strict"
import test from "node:test"

import { GitHubClient } from "./github.js"
import { createAppServer } from "./server.js"
import type { AppConfig, IssueComment, PullRequestCommit, PullRequestFile, PullRequestReview } from "./types.js"

test("approves only once when duplicate pull request webhooks are processed concurrently", async () => {
    const githubClient = new FakeGitHubClient()

    await withTestServer(githubClient, async (url) => {
        const responses = await Promise.all([
            postWebhook(url, pullRequestPayload()),
            postWebhook(url, pullRequestPayload())
        ])

        assert.equal(githubClient.reviews.length, 1)
        assert.equal(responses.filter((response) => response.alreadyApproved === true).length, 1)
    })
})

test("comments only once when duplicate pull request webhooks are processed concurrently", async () => {
    const githubClient = new FakeGitHubClient({
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-ggr8-5vv4-36mx": {
                severity: "low"
            }
        }),
        severity: "high"
    })

    await withTestServer(githubClient, async (url) => {
        const responses = await Promise.all([
            postWebhook(url, pullRequestPayload()),
            postWebhook(url, pullRequestPayload())
        ])

        assert.equal(githubClient.comments.length, 1)
        assert.equal(responses.filter((response) => response.alreadyCommented === true).length, 1)
    })
})

class FakeGitHubClient extends GitHubClient {
    public readonly comments: IssueComment[] = []
    public readonly reviews: PullRequestReview[] = []
    private readonly baseNsprcContent?: string
    private readonly commits: PullRequestCommit[]
    private readonly files: PullRequestFile[]
    private readonly headNsprcContent?: string
    private readonly severity: string | undefined

    public constructor(options: FakeGitHubClientOptions = {}) {
        super("1", "unused")
        this.baseNsprcContent = options.baseNsprcContent
        this.commits = options.commits ?? [commit("1111111", "ci@js-soft.com")]
        this.files = options.files ?? [{ filename: "package-lock.json" }]
        this.headNsprcContent = options.headNsprcContent
        this.severity = options.severity
    }

    public override async createInstallationAccessToken(): Promise<string> {
        return "token"
    }

    public override async listPullRequestCommits(): Promise<PullRequestCommit[]> {
        return this.commits
    }

    public override async listPullRequestFiles(): Promise<PullRequestFile[]> {
        return this.files
    }

    public override async getRepositoryFileText(input: { readonly ref: string }): Promise<string | undefined> {
        return input.ref === "base-sha" ? this.baseNsprcContent : this.headNsprcContent
    }

    public override async getGlobalSecurityAdvisorySeverity(): Promise<string | undefined> {
        return this.severity
    }

    public override async listPullRequestReviews(): Promise<PullRequestReview[]> {
        await delay(10)
        return [...this.reviews]
    }

    public override async approvePullRequest(): Promise<void> {
        await delay(10)
        this.reviews.push({
            body: "",
            commit_id: "head-sha",
            state: "APPROVED"
        })
    }

    public override async listIssueComments(): Promise<IssueComment[]> {
        await delay(10)
        return [...this.comments]
    }

    public override async createIssueComment(input: { readonly body: string }): Promise<void> {
        await delay(10)
        this.comments.push({ body: input.body })
    }
}

interface FakeGitHubClientOptions {
    readonly baseNsprcContent?: string
    readonly commits?: PullRequestCommit[]
    readonly files?: PullRequestFile[]
    readonly headNsprcContent?: string
    readonly severity?: string
}

async function withTestServer(githubClient: GitHubClient, run: (url: string) => Promise<void>): Promise<void> {
    const server = createAppServer(config(), githubClient)

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject)
            resolve()
        })
    })

    const address = server.address()
    assert.notEqual(address, null)
    assert.notEqual(typeof address, "string")

    try {
        await run(`http://127.0.0.1:${(address as AddressInfo).port}`)
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
}

async function postWebhook(url: string, payload: ReturnType<typeof pullRequestPayload>): Promise<Record<string, unknown>> {
    const body = JSON.stringify(payload)
    const response = await fetch(`${url}/webhook`, {
        body,
        headers: {
            "content-type": "application/json",
            "x-github-event": "pull_request",
            "x-hub-signature-256": sign(body, config().webhookSecret)
        },
        method: "POST"
    })

    assert.equal(response.status, 202)

    return (await response.json()) as Record<string, unknown>
}

function pullRequestPayload() {
    return {
        action: "labeled",
        installation: {
            id: 1
        },
        pull_request: {
            base: {
                sha: "base-sha"
            },
            draft: false,
            head: {
                sha: "head-sha"
            },
            labels: [{ name: "dependencies" }],
            number: 64
        },
        repository: {
            name: "repo",
            owner: {
                login: "js-soft"
            }
        }
    }
}

function commit(sha: string, authorEmail: string): PullRequestCommit {
    return {
        commit: {
            author: {
                email: authorEmail,
                name: "CI"
            }
        },
        sha
    }
}

function config(): AppConfig {
    return {
        appId: "1",
        approvedAuthorEmail: "ci@js-soft.com",
        port: 0,
        privateKey: "unused",
        webhookSecret: "secret"
    }
}

function sign(body: string, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
}

async function delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}
