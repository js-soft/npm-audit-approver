import type { ApprovalDecision, ApprovalInput, PullRequestCommit } from "./types.js"

export const pullRequestActionsToEvaluate = new Set(["labeled", "opened", "reopened", "ready_for_review", "synchronize"])

const allowedChangedFiles = new Set([".nsprc", "package-lock.json"])
const labelsAllowedToApprove = new Set(["chore", "dependencies"])
const allowedAddedExceptionSeverities = new Set(["low", "medium", "moderate"])
const maxAddedNsprcExceptions = 2

export async function decideApproval(input: ApprovalInput): Promise<ApprovalDecision> {
    const authorDecision = decideCommitAuthorApproval(input.commits, input.approvedAuthorEmail)

    if (!authorDecision.approve) return authorDecision

    const filesDecision = decideChangedFilesApproval(input.files)

    if (!filesDecision.approve) return filesDecision

    const labelsDecision = decideLabelsApproval(input.labels)

    if (!labelsDecision.approve) return labelsDecision

    const nsprcDecision = await decideNsprcApproval(
        input.baseNsprcContent,
        input.headNsprcContent,
        input.getVulnerabilitySeverity
    )

    if (!nsprcDecision.approve) return nsprcDecision

    return {
        approve: true,
        reason: [
            authorDecision.reason,
            filesDecision.reason,
            labelsDecision.reason,
            nsprcDecision.reason
        ].join("; "),
        shouldComment: false
    }
}

function decideCommitAuthorApproval(
    commits: readonly PullRequestCommit[],
    approvedAuthorEmail: string
): ApprovalDecision {
    if (commits.length === 0) {
        return {
            approve: false,
            reason: "pull request has no commits",
            shouldComment: false
        }
    }

    const expectedEmail = approvedAuthorEmail.toLowerCase()
    const commitsWithDifferentAuthor = commits.filter((commit) => getAuthorEmail(commit) !== expectedEmail)
    const commitsWithApprovedAuthor = commits.filter((commit) => getAuthorEmail(commit) === expectedEmail)

    if (commitsWithDifferentAuthor.length > 0) {
        const examples = commitsWithDifferentAuthor
            .slice(0, 3)
            .map((commit) => `${commit.sha.slice(0, 7)}:${getAuthorEmail(commit) || "missing-email"}`)
            .join(", ")

        return {
            approve: false,
            reason: `not every commit is authored by ${approvedAuthorEmail}; mismatches: ${examples}`,
            shouldComment: commitsWithApprovedAuthor.length > 0
        }
    }

    return {
        approve: true,
        reason: `all ${commits.length} commit(s) are authored by ${approvedAuthorEmail}`,
        shouldComment: false
    }
}

function decideChangedFilesApproval(files: ApprovalInput["files"]): ApprovalDecision {
    if (files.length === 0) {
        return {
            approve: false,
            reason: "pull request has no changed files",
            shouldComment: true
        }
    }

    const disallowedFiles = files.filter((file) => !allowedChangedFiles.has(file.filename))

    if (disallowedFiles.length > 0) {
        const examples = disallowedFiles
            .slice(0, 3)
            .map((file) => file.filename)
            .join(", ")

        return {
            approve: false,
            reason: `pull request changes files outside package-lock.json and .nsprc: ${examples}`,
            shouldComment: true
        }
    }

    return {
        approve: true,
        reason: "only package-lock.json and .nsprc are changed",
        shouldComment: false
    }
}

function decideLabelsApproval(labels: ApprovalInput["labels"]): ApprovalDecision {
    const matchingLabel = labels
        .map((label) => label.name.trim().toLowerCase())
        .find((label) => labelsAllowedToApprove.has(label))

    if (!matchingLabel) {
        return {
            approve: false,
            reason: "pull request does not have a dependencies or chore label",
            shouldComment: true
        }
    }

    return {
        approve: true,
        reason: `pull request has the ${matchingLabel} label`,
        shouldComment: false
    }
}

async function decideNsprcApproval(
    baseContent: string | undefined,
    headContent: string | undefined,
    getVulnerabilitySeverity: (id: string) => Promise<string | undefined>
): Promise<ApprovalDecision> {
    const baseExceptions = parseNsprc(baseContent, "base")
    const headExceptions = parseNsprc(headContent, "head")

    if (!baseExceptions.ok) return baseExceptions.decision
    if (!headExceptions.ok) return headExceptions.decision

    const addedExceptions = [...headExceptions.exceptions.keys()].filter((id) => !baseExceptions.exceptions.has(id))

    if (addedExceptions.length > maxAddedNsprcExceptions) {
        return {
            approve: false,
            reason: `.nsprc adds ${addedExceptions.length} exception(s), which is more than ${maxAddedNsprcExceptions}`,
            shouldComment: true
        }
    }

    const addedExceptionSeverities = await Promise.all(
        addedExceptions.map(async (id) => ({
            id,
            severity: normalizeSeverity(await getVulnerabilitySeverity(id))
        }))
    )
    const addedExceptionsWithDisallowedSeverity = addedExceptionSeverities.filter(
        ({ severity }) => !severity || !allowedAddedExceptionSeverities.has(severity)
    )

    if (addedExceptionsWithDisallowedSeverity.length > 0) {
        const examples = addedExceptionsWithDisallowedSeverity
            .slice(0, 3)
            .map(({ id, severity }) => `${id}:${severity ?? "missing-github-severity"}`)
            .join(", ")

        return {
            approve: false,
            reason: `.nsprc adds exception(s) that are not low, medium, or moderate severity: ${examples}`,
            shouldComment: true
        }
    }

    return {
        approve: true,
        reason: `.nsprc adds ${addedExceptions.length} low, medium, or moderate severity exception(s)`,
        shouldComment: false
    }
}

function getAuthorEmail(commit: PullRequestCommit): string {
    return commit.commit.author?.email?.toLowerCase().trim() ?? ""
}

function parseNsprc(
    content: string | undefined,
    refName: "base" | "head"
): { ok: true; exceptions: Map<string, unknown> } | { ok: false; decision: ApprovalDecision } {
    if (content === undefined || content.trim() === "") {
        return { ok: true, exceptions: new Map() }
    }

    let parsed: unknown

    try {
        parsed = JSON.parse(content)
    } catch (error) {
        return {
            ok: false,
            decision: {
                approve: false,
                reason: `${refName} .nsprc is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
                shouldComment: true
            }
        }
    }

    if (!isPlainObject(parsed)) {
        return {
            ok: false,
            decision: {
                approve: false,
                reason: `${refName} .nsprc must be a JSON object`,
                shouldComment: true
            }
        }
    }

    return {
        ok: true,
        exceptions: new Map(Object.entries(parsed))
    }
}

function normalizeSeverity(severity: string | undefined): string | undefined {
    return severity?.trim().toLowerCase()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}
