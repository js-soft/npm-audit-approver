import { Octokit } from "@octokit/rest"

import { createAppJwt } from "./crypto.js"
import type {
    IssueComment,
    PullRequestCommit,
    PullRequestFile,
    PullRequestReview,
    PullRequestReviewTeam
} from "./types.js"

export class GitHubClient {
    public constructor(
        private readonly appId: string,
        private readonly privateKey: string
    ) {}

    public async createInstallationAccessToken(installationId: number): Promise<string> {
        const response = await this.createClient(createAppJwt(this.appId, this.privateKey))
            .rest.apps.createInstallationAccessToken({
                installation_id: installationId
            })

        return response.data.token
    }

    public async listPullRequestCommits(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestCommit[]> {
        const client = this.createClient(input.token)

        return await client.paginate(client.rest.pulls.listCommits, {
            owner: input.owner,
            per_page: 100,
            pull_number: input.pullNumber,
            repo: input.repo
        })
    }

    public async listPullRequestFiles(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestFile[]> {
        const client = this.createClient(input.token)

        return await client.paginate(client.rest.pulls.listFiles, {
            owner: input.owner,
            per_page: 100,
            pull_number: input.pullNumber,
            repo: input.repo
        })
    }

    public async getRepositoryFileText(input: {
        readonly owner: string
        readonly repo: string
        readonly path: string
        readonly ref: string
        readonly token: string
    }): Promise<string | undefined> {
        let data: RepositoryContentResponse | RepositoryContentResponse[]

        try {
            const response = await this.createClient(input.token).rest.repos.getContent({
                owner: input.owner,
                path: input.path,
                ref: input.ref,
                repo: input.repo
            })

            data = response.data as RepositoryContentResponse | RepositoryContentResponse[]
        } catch (error) {
            if (isGitHubRequestError(error) && error.status === 404) {
                return undefined
            }

            throw error
        }

        if (Array.isArray(data) || data.type !== "file") {
            return undefined
        }

        if (data.encoding !== "base64") {
            throw new Error(
                `GitHub API returned ${input.path} with unsupported encoding: ${data.encoding ?? "missing"}`
            )
        }

        return Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8")
    }

    public async getGlobalSecurityAdvisorySeverity(input: {
        readonly ghsaId: string
        readonly token: string
    }): Promise<string | undefined> {
        try {
            const response = await this.createClient(input.token).rest.securityAdvisories.getGlobalAdvisory({
                ghsa_id: input.ghsaId
            })

            return response.data.severity
        } catch (error) {
            if (isGitHubRequestError(error) && error.status === 404) {
                return undefined
            }

            throw error
        }
    }

    public async approvePullRequest(input: {
        readonly body?: string
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<void> {
        await this.createClient(input.token).rest.pulls.createReview({
            ...(input.body === undefined ? {} : { body: input.body }),
            event: "APPROVE",
            owner: input.owner,
            pull_number: input.pullNumber,
            repo: input.repo
        })
    }

    public async listRequestedPullRequestReviewTeams(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestReviewTeam[]> {
        const response = await this.createClient(input.token).rest.pulls.listRequestedReviewers({
            owner: input.owner,
            pull_number: input.pullNumber,
            repo: input.repo
        })

        return response.data.teams.map((team) => ({
            slug: team.slug
        }))
    }

    public async requestPullRequestTeamReviewers(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly teamReviewers: readonly string[]
        readonly token: string
    }): Promise<void> {
        await this.createClient(input.token).rest.pulls.requestReviewers({
            owner: input.owner,
            pull_number: input.pullNumber,
            repo: input.repo,
            team_reviewers: [...input.teamReviewers]
        })
    }

    public async listPullRequestReviews(input: {
        readonly owner: string
        readonly repo: string
        readonly pullNumber: number
        readonly token: string
    }): Promise<PullRequestReview[]> {
        const client = this.createClient(input.token)
        const reviews = await client.paginate(client.rest.pulls.listReviews, {
            owner: input.owner,
            per_page: 100,
            pull_number: input.pullNumber,
            repo: input.repo
        })

        return reviews.map((review) => ({
            body: review.body,
            commit_id: review.commit_id ?? "",
            state: review.state
        }))
    }

    public async listIssueComments(input: {
        readonly owner: string
        readonly repo: string
        readonly issueNumber: number
        readonly token: string
    }): Promise<IssueComment[]> {
        const client = this.createClient(input.token)
        const comments = await client.paginate(client.rest.issues.listComments, {
            issue_number: input.issueNumber,
            owner: input.owner,
            per_page: 100,
            repo: input.repo
        })

        return comments.map((comment) => ({
            body: comment.body ?? null
        }))
    }

    public async createIssueComment(input: {
        readonly body: string
        readonly owner: string
        readonly repo: string
        readonly issueNumber: number
        readonly token: string
    }): Promise<void> {
        await this.createClient(input.token).rest.issues.createComment({
            body: input.body,
            issue_number: input.issueNumber,
            owner: input.owner,
            repo: input.repo
        })
    }

    private createClient(token: string): Octokit {
        return new Octokit({
            auth: token,
            request: {
                headers: {
                    "X-GitHub-Api-Version": "2022-11-28"
                }
            },
            userAgent: "js-soft-npm-audit-approver"
        })
    }
}

interface RepositoryContentResponse {
    readonly content: string
    readonly encoding?: string
    readonly type: string
}

function isGitHubRequestError(error: unknown): error is { readonly status: number } {
    return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
}
