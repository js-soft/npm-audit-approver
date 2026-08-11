import assert from "node:assert/strict"
import test from "node:test"

import { decideApproval, pullRequestActionsToEvaluate } from "./approval.js"
import type { ApprovalInput, PullRequestCommit } from "./types.js"

test("evaluates pull requests when a label is added", () => {
    assert.equal(pullRequestActionsToEvaluate.has("labeled"), true)
})

test("approves when every commit is authored by the approved email", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        commits: [commit("1111111", "ci@js-soft.com"), commit("2222222", "CI@JS-SOFT.COM")]
    })

    assert.equal(decision.approve, true)
})

test("does not approve when a commit has a different author email", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        commits: [commit("1111111", "ci@js-soft.com"), commit("2222222", "person@example.com")]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /person@example.com/)
    assert.equal(decision.shouldComment, true)
})

test("does not approve pull requests without commits", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        commits: []
    })

    assert.equal(decision.approve, false)
    assert.equal(decision.shouldComment, false)
})

test("does not comment when no commit is authored by the approved email", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        commits: [commit("1111111", "person@example.com"), commit("2222222", "other@example.com")]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /person@example.com/)
    assert.equal(decision.shouldComment, false)
})

test("does not approve when files outside package-lock.json and .nsprc changed", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        files: [{ filename: "package-lock.json" }, { filename: "src/index.ts" }]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /src\/index\.ts/)
})

test("does not approve without dependencies or chore label", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        labels: [{ name: "security" }]
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /dependencies or chore/)
})

test("approves at most two added low, medium, or moderate nsprc exceptions using GitHub advisory severities", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        baseNsprcContent: JSON.stringify({
            "GHSA-existing": {
                severity: "high"
            }
        }),
        files: [{ filename: "package-lock.json" }, { filename: ".nsprc" }],
        getVulnerabilitySeverity: async (id) =>
            new Map([
                ["GHSA-low", "Low"],
                ["GHSA-medium", "Medium"]
            ]).get(id),
        headNsprcContent: JSON.stringify({
            "GHSA-existing": {
                severity: "high"
            },
            "GHSA-low": {
                severity: "high"
            },
            "GHSA-medium": {
                severity: "critical"
            }
        })
    })

    assert.equal(decision.approve, true)
})

test("does not approve more than two added nsprc exceptions", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-one": {
                severity: "low"
            },
            "GHSA-two": {
                severity: "medium"
            },
            "GHSA-three": {
                severity: "low"
            }
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /more than 2/)
})

test("does not approve added nsprc exceptions above moderate severity from GitHub", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        getVulnerabilitySeverity: async () => "high",
        headNsprcContent: JSON.stringify({
            "GHSA-high": {
                severity: "low"
            }
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /GHSA-high:high/)
})

test("does not approve added nsprc exceptions without GitHub severity", async () => {
    const decision = await decideApproval({
        ...approvalInput(),
        baseNsprcContent: "{}",
        files: [{ filename: ".nsprc" }],
        headNsprcContent: JSON.stringify({
            "GHSA-missing": "legacy exception note"
        })
    })

    assert.equal(decision.approve, false)
    assert.match(decision.reason, /GHSA-missing:missing-github-severity/)
})

function approvalInput(): ApprovalInput {
    return {
        approvedAuthorEmail: "ci@js-soft.com",
        commits: [commit("1111111", "ci@js-soft.com")],
        files: [{ filename: "package-lock.json" }],
        getVulnerabilitySeverity: async () => undefined,
        labels: [{ name: "dependencies" }]
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
