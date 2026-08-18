import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { decideApproval, pullRequestActionsToEvaluate } from "./approval.js"
import { verifyWebhookSignature } from "./crypto.js"
import { GitHubClient } from "./github.js"
import type { AppConfig, PullRequestWebhookPayload } from "./types.js"

const manualReviewTeamSlug = "npm-dependency-update-reviewers"

export function createAppServer(
    config: AppConfig,
    githubClient = new GitHubClient(config.appId, config.privateKey)
): Server {
    const pullRequestLocks: PullRequestLocks = new Map()

    return createServer(async (request, response) => {
        try {
            if (request.method === "GET" && request.url === "/healthz") {
                sendJson(response, 200, { ok: true })
                return
            }

            if (request.method === "POST" && request.url === "/webhook") {
                await handleWebhook(request, response, config, githubClient, pullRequestLocks)
                return
            }

            sendJson(response, 404, { error: "not found" })
        } catch (error) {
            console.error(error)
            sendJson(response, 500, { error: "internal server error" })
        }
    })
}

async function handleWebhook(
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    githubClient: GitHubClient,
    pullRequestLocks: PullRequestLocks
): Promise<void> {
    const body = await readRequestBody(request)
    const signature = getHeader(request, "x-hub-signature-256")

    if (!verifyWebhookSignature(body, signature, config.webhookSecret)) {
        sendJson(response, 401, { error: "invalid webhook signature" })
        return
    }

    const event = getHeader(request, "x-github-event")

    if (event === "ping") {
        sendJson(response, 202, { ok: true, message: "pong" })
        return
    }

    if (event !== "pull_request") {
        sendJson(response, 202, { ok: true, message: `ignored ${event ?? "unknown"} event` })
        return
    }

    const payload = JSON.parse(body.toString("utf8")) as PullRequestWebhookPayload

    if (!pullRequestActionsToEvaluate.has(payload.action)) {
        sendJson(response, 202, { ok: true, message: `ignored pull_request.${payload.action}` })
        return
    }

    if (payload.pull_request.draft) {
        sendJson(response, 202, { ok: true, message: "ignored draft pull request" })
        return
    }

    const installationId = payload.installation?.id

    if (!installationId) {
        sendJson(response, 400, { error: "pull_request webhook is missing installation.id" })
        return
    }

    const owner = payload.repository.owner.login
    const repo = payload.repository.name
    const pullNumber = payload.pull_request.number
    const lockKey = `${owner}/${repo}#${pullNumber}`

    await withPullRequestLock(pullRequestLocks, lockKey, async () => {
        const token = await githubClient.createInstallationAccessToken(installationId)
        const [commits, files] = await Promise.all([
            githubClient.listPullRequestCommits({
                owner,
                pullNumber,
                repo,
                token
            }),
            githubClient.listPullRequestFiles({
                owner,
                pullNumber,
                repo,
                token
            })
        ])
        const nsprcChanged = files.some((file) => file.filename === ".nsprc")
        const [baseNsprcContent, headNsprcContent] = nsprcChanged
            ? await Promise.all([
                  githubClient.getRepositoryFileText({
                      owner,
                      path: ".nsprc",
                      ref: payload.pull_request.base.sha,
                      repo,
                      token
                  }),
                  githubClient.getRepositoryFileText({
                      owner,
                      path: ".nsprc",
                      ref: payload.pull_request.head.sha,
                      repo,
                      token
                  })
              ])
            : [undefined, undefined]
        const decision = await decideApproval({
            approvedAuthorEmail: config.approvedAuthorEmail,
            baseNsprcContent,
            commits,
            files,
            getVulnerabilitySeverity: (id) =>
                githubClient.getGlobalSecurityAdvisorySeverity({
                    ghsaId: id,
                    token
                }),
            headNsprcContent,
            labels: payload.pull_request.labels ?? []
        })

        if (!decision.approve) {
            let alreadyCommented = false

            if (decision.shouldComment) {
                const commentBody = `Automatic approval was not made because ${decision.reason}.`
                const existingComments = await githubClient.listIssueComments({
                    issueNumber: pullNumber,
                    owner,
                    repo,
                    token
                })
                alreadyCommented = existingComments.some((comment) => comment.body === commentBody)

                if (!alreadyCommented) {
                    await githubClient.createIssueComment({
                        body: commentBody,
                        issueNumber: pullNumber,
                        owner,
                        repo,
                        token
                    })
                }
            }

            const requestedReviewTeams = await githubClient.listRequestedPullRequestReviewTeams({
                owner,
                pullNumber,
                repo,
                token
            })
            const alreadyReviewRequested = requestedReviewTeams.some((team) => team.slug === manualReviewTeamSlug)

            if (!alreadyReviewRequested) {
                await githubClient.requestPullRequestTeamReviewers({
                    owner,
                    pullNumber,
                    repo,
                    teamReviewers: [manualReviewTeamSlug],
                    token
                })
            }

            console.info(`Skipping ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
            sendJson(response, 202, {
                approved: false,
                alreadyCommented,
                alreadyReviewRequested,
                commentSkipped: !decision.shouldComment,
                reason: decision.reason
            })
            return
        }

        const existingReviews = await githubClient.listPullRequestReviews({
            owner,
            pullNumber,
            repo,
            token
        })
        const alreadyApproved = existingReviews.some(
            (review) =>
                review.state === "APPROVED" &&
                review.commit_id === payload.pull_request.head.sha
        )

        if (alreadyApproved) {
            console.info(`Already approved ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
            sendJson(response, 202, { approved: true, alreadyApproved: true, reason: decision.reason })
            return
        }

        await githubClient.approvePullRequest({
            owner,
            pullNumber,
            repo,
            token
        })

        console.info(`Approved ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
        sendJson(response, 202, { approved: true, reason: decision.reason })
    })
}

type PullRequestLocks = Map<string, Promise<void>>

async function withPullRequestLock<T>(
    locks: PullRequestLocks,
    key: string,
    task: () => Promise<T>
): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
        release = resolve
    })
    const current = previous.catch(() => undefined).then(() => next)

    locks.set(key, current)
    await previous.catch(() => undefined)

    try {
        return await task()
    } finally {
        release()

        if (locks.get(key) === current) {
            locks.delete(key)
        }
    }
}

function getHeader(request: IncomingMessage, headerName: string): string | undefined {
    const value = request.headers[headerName]

    return Array.isArray(value) ? value[0] : value
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = []

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }

    return Buffer.concat(chunks)
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
    response.writeHead(statusCode, {
        "content-type": "application/json"
    })
    response.end(JSON.stringify(body))
}
