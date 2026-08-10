import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { decideApproval, pullRequestActionsToEvaluate } from "./approval.js"
import { verifyWebhookSignature } from "./crypto.js"
import { GitHubClient } from "./github.js"
import type { AppConfig, PullRequestWebhookPayload } from "./types.js"

export function createAppServer(
    config: AppConfig,
    githubClient = new GitHubClient(config.appId, config.privateKey)
): Server {
    return createServer(async (request, response) => {
        try {
            if (request.method === "GET" && request.url === "/healthz") {
                sendJson(response, 200, { ok: true })
                return
            }

            if (request.method === "POST" && request.url === "/webhook") {
                await handleWebhook(request, response, config, githubClient)
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
    githubClient: GitHubClient
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
    const token = await githubClient.createInstallationAccessToken(installationId)
    const commits = await githubClient.listPullRequestCommits({
        owner,
        pullNumber,
        repo,
        token
    })
    const decision = decideApproval(commits, config.approvedAuthorEmail)

    if (!decision.approve) {
        console.info(`Skipping ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
        sendJson(response, 202, { approved: false, reason: decision.reason })
        return
    }

    const approvalBody = `Automatically approved because ${decision.reason}.`
    const existingReviews = await githubClient.listPullRequestReviews({
        owner,
        pullNumber,
        repo,
        token
    })
    const alreadyApproved = existingReviews.some(
        (review) =>
            review.state === "APPROVED" &&
            review.commit_id === payload.pull_request.head.sha &&
            review.body === approvalBody
    )

    if (alreadyApproved) {
        console.info(`Already approved ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
        sendJson(response, 202, { approved: true, alreadyApproved: true, reason: decision.reason })
        return
    }

    await githubClient.approvePullRequest({
        body: approvalBody,
        owner,
        pullNumber,
        repo,
        token
    })

    console.info(`Approved ${owner}/${repo}#${pullNumber}: ${decision.reason}`)
    sendJson(response, 202, { approved: true, reason: decision.reason })
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
