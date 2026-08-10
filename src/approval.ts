import type { ApprovalDecision, PullRequestCommit } from "./types.js"

export const pullRequestActionsToEvaluate = new Set(["opened", "reopened", "ready_for_review", "synchronize"])

export function decideApproval(commits: readonly PullRequestCommit[], approvedAuthorEmail: string): ApprovalDecision {
    if (commits.length === 0) {
        return {
            approve: false,
            reason: "pull request has no commits"
        }
    }

    const expectedEmail = approvedAuthorEmail.toLowerCase()
    const commitsWithDifferentAuthor = commits.filter((commit) => getAuthorEmail(commit) !== expectedEmail)

    if (commitsWithDifferentAuthor.length > 0) {
        const examples = commitsWithDifferentAuthor
            .slice(0, 3)
            .map((commit) => `${commit.sha.slice(0, 7)}:${getAuthorEmail(commit) || "missing-email"}`)
            .join(", ")

        return {
            approve: false,
            reason: `not every commit is authored by ${approvedAuthorEmail}; mismatches: ${examples}`
        }
    }

    return {
        approve: true,
        reason: `all ${commits.length} commit(s) are authored by ${approvedAuthorEmail}`
    }
}

function getAuthorEmail(commit: PullRequestCommit): string {
    return commit.commit.author?.email?.toLowerCase().trim() ?? ""
}
